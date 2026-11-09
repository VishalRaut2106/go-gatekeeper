import { Request, Response } from 'express';
import { growthCalculator } from '../../analytics/growthCalculator.js';
import { config } from '../../config.js';
import { Logger } from '../../logger.js';

const logger = new Logger('AnalyticsController');

export async function getDownloadsAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const pkg = (req.query.package as string) || config.packageName;
    const report = await growthCalculator.generateReport(pkg);
    res.json(report);
  } catch (err: any) {
    logger.error(`Error generating analytics report: ${err.message}`);
    res.status(500).json({
      error: 'AnalyticsError',
      message: 'Failed to fetch and calculate download analytics.',
      details: err.message,
    });
  }
}
