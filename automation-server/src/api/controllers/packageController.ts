import { Request, Response } from 'express';
import { npmClient } from '../../analytics/npmClient.js';
import { config } from '../../config.js';
import { Logger } from '../../logger.js';

const logger = new Logger('PackageController');

export async function getPackageVersion(req: Request, res: Response): Promise<void> {
  try {
    const pkg = (req.query.package as string) || config.packageName;
    const details = await npmClient.fetchPackageDetails(pkg);
    res.json(details);
  } catch (err: any) {
    logger.error(`Error fetching package metadata: ${err.message}`);
    res.status(500).json({
      error: 'PackageRegistryError',
      message: 'Failed to retrieve package metadata from registry.',
      details: err.message,
    });
  }
}
