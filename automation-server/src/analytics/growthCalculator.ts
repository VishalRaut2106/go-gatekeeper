import { npmClient, NpmPointDownloads, NpmRangeDownloads, NpmPackageDetails } from './npmClient.js';
import { testsRepository, TestStats } from '../database/repositories/testsRepository.js';
import { config } from '../config.js';

export interface GrowthAnalyticsReport {
  packageName: string;
  latestVersion: string;
  downloads: {
    today: number;
    lastDay: number;
    lastWeek: number;
    lastMonth: number;
    weeklyGrowthRatePercentage: number;
  };
  installationTests: {
    totalRuns: number;
    successRatePercentage: number;
    lastSuccessfulTestAt: string | null;
    averageDurationMs: number;
  };
  comparison: {
    npmReportedDownloads: number;
    automatedTestRuns: number;
    testToDownloadRatioPercentage: number;
    note: string;
  };
  history: Array<{
    day: string;
    downloads: number;
  }>;
  distTags: Record<string, string>;
  fetchedAt: string;
}

export class GrowthCalculator {
  calculateGrowthPercentage(current: number, previous: number): number {
    if (previous <= 0) {
      return current > 0 ? 100 : 0;
    }
    const growth = ((current - previous) / previous) * 100;
    return Math.round(growth * 10) / 10;
  }

  async generateReport(packageName = config.packageName): Promise<GrowthAnalyticsReport> {
    const [dayPoint, weekPoint, monthPoint, rangeData, packageDetails, testStats] = await Promise.all([
      npmClient.fetchPointDownloads('last-day', packageName),
      npmClient.fetchPointDownloads('last-week', packageName),
      npmClient.fetchPointDownloads('last-month', packageName),
      npmClient.fetchRangeDownloads('last-month', packageName),
      npmClient.fetchPackageDetails(packageName),
      testsRepository.getTestStats(),
    ]);

    // Calculate weekly growth trend from daily range if available
    let weeklyGrowth = 0;
    const days = rangeData.downloads || [];
    if (days.length >= 14) {
      const recent7 = days.slice(-7).reduce((sum, d) => sum + d.downloads, 0);
      const prior7 = days.slice(-14, -7).reduce((sum, d) => sum + d.downloads, 0);
      weeklyGrowth = this.calculateGrowthPercentage(recent7, prior7);
    } else {
      // Approximate fallback
      const avgWeeklyFromMonth = monthPoint.downloads / 4.3;
      weeklyGrowth = this.calculateGrowthPercentage(weekPoint.downloads, avgWeeklyFromMonth);
    }

    const todayCount = days.length > 0 ? days[days.length - 1].downloads : dayPoint.downloads;
    const testToDownloadRatio =
      monthPoint.downloads > 0
        ? Math.round((testStats.totalRuns / monthPoint.downloads) * 100)
        : 0;

    return {
      packageName,
      latestVersion: packageDetails.latestVersion,
      downloads: {
        today: todayCount,
        lastDay: dayPoint.downloads,
        lastWeek: weekPoint.downloads,
        lastMonth: monthPoint.downloads,
        weeklyGrowthRatePercentage: weeklyGrowth,
      },
      installationTests: {
        totalRuns: testStats.totalRuns,
        successRatePercentage: testStats.successRate,
        lastSuccessfulTestAt: testStats.lastSuccessfulTest?.created_at || null,
        averageDurationMs: testStats.averageDurationMs,
      },
      comparison: {
        npmReportedDownloads: monthPoint.downloads,
        automatedTestRuns: testStats.totalRuns,
        testToDownloadRatioPercentage: testToDownloadRatio,
        note: 'Official npm download metrics are gathered from api.npmjs.org and kept strictly separate from local worker installation tests to prevent metric fabrication.',
      },
      history: days.map((d) => ({
        day: d.day,
        downloads: d.downloads,
      })),
      distTags: packageDetails.distTags,
      fetchedAt: new Date().toISOString(),
    };
  }
}

export const growthCalculator = new GrowthCalculator();
