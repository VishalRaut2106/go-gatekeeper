import { config } from '../config.js';
import { Logger } from '../logger.js';
import { analyticsRepository, DownloadSnapshot, PackageMetadataRecord } from '../database/repositories/analyticsRepository.js';

const logger = new Logger('NpmClient');

export interface NpmPointDownloads {
  downloads: number;
  start: string;
  end: string;
  package: string;
}

export interface NpmRangeDownloads {
  package: string;
  downloads: Array<{ downloads: number; day: string }>;
  start: string;
  end: string;
}

export interface NpmPackageDetails {
  name: string;
  latestVersion: string;
  distTags: Record<string, string>;
  description?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  releaseDate?: string;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class NpmClient {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultCacheTtlMs = 15 * 60 * 1000; // 15 minutes TTL

  private getFromMemoryCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setMemoryCache<T>(key: string, data: T, ttlMs = this.defaultCacheTtlMs): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async fetchPointDownloads(
    period: 'last-day' | 'last-week' | 'last-month',
    packageName = config.packageName
  ): Promise<NpmPointDownloads> {
    const cacheKey = `point:${period}:${packageName}`;
    const cached = this.getFromMemoryCache<NpmPointDownloads>(cacheKey);
    if (cached) return cached;

    const url = `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(packageName)}`;

    try {
      logger.debug(`Fetching npm point downloads: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Gatekeeper-Automation-Server/1.0' } });
      if (!res.ok) {
        throw new Error(`npm downloads API returned status ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as NpmPointDownloads;

      // Save to memory cache
      this.setMemoryCache(cacheKey, data);

      // Persist snapshot to database
      try {
        await analyticsRepository.saveDownloadSnapshot({
          period,
          downloads: data.downloads || 0,
          start_date: data.start,
          end_date: data.end,
          package_name: packageName,
          raw_data: JSON.stringify(data),
          created_at: new Date().toISOString(),
        });
      } catch (dbErr: any) {
        logger.warn(`Failed to persist download snapshot to DB: ${dbErr.message}`);
      }

      return data;
    } catch (err: any) {
      logger.error(`Error fetching point downloads for ${packageName} (${period}): ${err.message}`);

      // Attempt fallback to last database snapshot
      const snapshot = await analyticsRepository.getLatestSnapshot(period, packageName);
      if (snapshot) {
        logger.info(`Using cached database snapshot for ${period} (${snapshot.downloads} downloads)`);
        return {
          downloads: snapshot.downloads,
          start: snapshot.start_date,
          end: snapshot.end_date,
          package: snapshot.package_name,
        };
      }

      // Safe empty fallback
      return {
        downloads: 0,
        start: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
        package: packageName,
      };
    }
  }

  async fetchRangeDownloads(
    period: 'last-month' | 'last-week' = 'last-month',
    packageName = config.packageName
  ): Promise<NpmRangeDownloads> {
    const cacheKey = `range:${period}:${packageName}`;
    const cached = this.getFromMemoryCache<NpmRangeDownloads>(cacheKey);
    if (cached) return cached;

    const url = `https://api.npmjs.org/downloads/range/${period}/${encodeURIComponent(packageName)}`;

    try {
      logger.debug(`Fetching npm range downloads: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Gatekeeper-Automation-Server/1.0' } });
      if (!res.ok) {
        throw new Error(`npm range API returned ${res.status}`);
      }
      const data = (await res.json()) as NpmRangeDownloads;

      this.setMemoryCache(cacheKey, data);
      return data;
    } catch (err: any) {
      logger.error(`Error fetching range downloads for ${packageName}: ${err.message}`);
      return {
        package: packageName,
        downloads: [],
        start: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      };
    }
  }

  async fetchPackageDetails(packageName = config.packageName): Promise<NpmPackageDetails> {
    const cacheKey = `details:${packageName}`;
    const cached = this.getFromMemoryCache<NpmPackageDetails>(cacheKey);
    if (cached) return cached;

    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;

    try {
      logger.debug(`Fetching registry metadata: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Gatekeeper-Automation-Server/1.0' } });
      if (!res.ok) {
        throw new Error(`npm registry returned status ${res.status}`);
      }
      const data: any = await res.json();
      const distTags = data['dist-tags'] || {};
      const latestVersion = distTags.latest || 'unknown';
      const latestVersionData = data.versions?.[latestVersion] || {};
      const releaseDate = data.time?.[latestVersion] || data.time?.modified;

      const details: NpmPackageDetails = {
        name: data.name || packageName,
        latestVersion,
        distTags,
        description: data.description || latestVersionData.description,
        homepage: data.homepage || latestVersionData.homepage,
        repository: typeof data.repository === 'object' ? data.repository?.url : data.repository,
        license: data.license || latestVersionData.license,
        releaseDate,
      };

      this.setMemoryCache(cacheKey, details);

      // Persist in metadata cache
      try {
        await analyticsRepository.savePackageMetadata({
          package_name: packageName,
          latest_version: latestVersion,
          dist_tags: JSON.stringify(distTags),
          homepage: details.homepage,
          repository_url: details.repository,
          updated_at: new Date().toISOString(),
        });
      } catch (dbErr: any) {
        logger.warn(`Failed to cache package metadata in DB: ${dbErr.message}`);
      }

      return details;
    } catch (err: any) {
      logger.error(`Error fetching package details for ${packageName}: ${err.message}`);
      const cachedDb = await analyticsRepository.getPackageMetadata(packageName);
      if (cachedDb) {
        return {
          name: cachedDb.package_name,
          latestVersion: cachedDb.latest_version,
          distTags: JSON.parse(cachedDb.dist_tags || '{}'),
          homepage: cachedDb.homepage || undefined,
          repository: cachedDb.repository_url || undefined,
        };
      }
      return {
        name: packageName,
        latestVersion: '2.1.2',
        distTags: { latest: '2.1.2' },
      };
    }
  }
}

export const npmClient = new NpmClient();
