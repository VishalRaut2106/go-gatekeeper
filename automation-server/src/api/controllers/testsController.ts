import { Request, Response } from 'express';
import { testsRepository } from '../../database/repositories/testsRepository.js';
import { workerManager } from '../../workers/workerManager.js';
import { config } from '../../config.js';
import { Logger } from '../../logger.js';

const logger = new Logger('TestsController');

export async function getTestsHistory(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
    const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));
    const status = req.query.status as string | undefined;

    const [tests, stats] = await Promise.all([
      testsRepository.getRecentTests(limit, offset, status),
      testsRepository.getTestStats(),
    ]);

    res.json({
      pagination: {
        limit,
        offset,
        count: tests.length,
      },
      stats,
      tests,
    });
  } catch (err: any) {
    logger.error(`Failed to fetch test history: ${err.message}`);
    res.status(500).json({
      error: 'DatabaseError',
      message: 'Failed to retrieve test run records.',
      details: err.message,
    });
  }
}

export async function getTestById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const test = await testsRepository.getTestById(id);
    if (!test) {
      res.status(404).json({
        error: 'NotFound',
        message: `Test run with ID "${id}" was not found.`,
      });
      return;
    }
    res.json(test);
  } catch (err: any) {
    logger.error(`Error fetching test ${req.params.id}: ${err.message}`);
    res.status(500).json({
      error: 'DatabaseError',
      message: 'Failed to retrieve test details.',
    });
  }
}

export async function runTest(req: Request, res: Response): Promise<void> {
  try {
    if (workerManager.isBusy()) {
      res.status(409).json({
        error: 'WorkerBusy',
        message: 'A test worker is already executing. Concurrency limit enforced to ensure system stability.',
        state: workerManager.getState(),
      });
      return;
    }

    const requestedVersion = req.body?.version || config.packageVersion || 'latest';
    const packageName = req.body?.packageName || config.packageName;

    // Strict validation of version string to prevent shell injection
    if (typeof requestedVersion !== 'string' || !/^(latest|next|beta|[0-9a-zA-Z\.\-\+]+)$/.test(requestedVersion)) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid version specified. Must be "latest" or a valid semantic version string.',
      });
      return;
    }

    logger.info(`Received manual request to trigger installation test for ${packageName}@${requestedVersion}`);

    const result = await workerManager.runTest({
      packageName,
      targetVersion: requestedVersion,
      triggerType: 'MANUAL',
    });

    res.status(result.success ? 200 : 500).json({
      message: result.success ? 'Installation test succeeded' : 'Installation test failed',
      result,
    });
  } catch (err: any) {
    logger.error(`Failed to execute manual test run: ${err.message}`);
    res.status(500).json({
      error: 'WorkerExecutionError',
      message: err.message,
    });
  }
}
