import { getDatabase } from '../db.js';

export interface DownloadSnapshot {
  id?: number;
  period: string; // 'last-day', 'last-week', 'last-month', 'range'
  downloads: number;
  start_date: string;
  end_date: string;
  package_name: string;
  raw_data?: string | null;
  created_at: string;
}

export interface PackageMetadataRecord {
  package_name: string;
  latest_version: string;
  dist_tags: string;
  homepage?: string | null;
  repository_url?: string | null;
  updated_at: string;
}

export class AnalyticsRepository {
  async saveDownloadSnapshot(snapshot: DownloadSnapshot): Promise<void> {
    const db = await getDatabase();
    const sql = `
      INSERT INTO download_snapshots (
        period, downloads, start_date, end_date, package_name, raw_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await db.execute(sql, [
      snapshot.period,
      snapshot.downloads,
      snapshot.start_date,
      snapshot.end_date,
      snapshot.package_name,
      snapshot.raw_data ?? null,
      snapshot.created_at,
    ]);
  }

  async getLatestSnapshot(period: string, packageName: string): Promise<DownloadSnapshot | null> {
    const db = await getDatabase();
    return db.queryOne<DownloadSnapshot>(
      'SELECT * FROM download_snapshots WHERE period = ? AND package_name = ? ORDER BY created_at DESC LIMIT 1',
      [period, packageName]
    );
  }

  async savePackageMetadata(meta: PackageMetadataRecord): Promise<void> {
    const db = await getDatabase();
    const existing = await db.queryOne(
      'SELECT package_name FROM package_metadata WHERE package_name = ?',
      [meta.package_name]
    );
    if (existing) {
      await db.execute(
        `UPDATE package_metadata SET
          latest_version = ?, dist_tags = ?, homepage = ?, repository_url = ?, updated_at = ?
         WHERE package_name = ?`,
        [meta.latest_version, meta.dist_tags, meta.homepage ?? null, meta.repository_url ?? null, meta.updated_at, meta.package_name]
      );
    } else {
      await db.execute(
        `INSERT INTO package_metadata (
          package_name, latest_version, dist_tags, homepage, repository_url, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [meta.package_name, meta.latest_version, meta.dist_tags, meta.homepage ?? null, meta.repository_url ?? null, meta.updated_at]
      );
    }
  }

  async getPackageMetadata(packageName: string): Promise<PackageMetadataRecord | null> {
    const db = await getDatabase();
    return db.queryOne<PackageMetadataRecord>(
      'SELECT * FROM package_metadata WHERE package_name = ?',
      [packageName]
    );
  }
}

export const analyticsRepository = new AnalyticsRepository();
