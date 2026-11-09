import { Request, Response } from 'express';
import os from 'os';
import { workerManager } from '../../workers/workerManager.js';
import { scheduler } from '../../scheduler/scheduler.js';
import { getDatabase } from '../../database/db.js';

const startTime = Date.now();

export async function getHealth(req: Request, res: Response): Promise<void> {
  let dbStatus = 'healthy';
  try {
    const db = await getDatabase();
    await db.queryOne('SELECT 1 as test');
  } catch (err: any) {
    dbStatus = `unhealthy: ${err.message}`;
  }

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const mem = process.memoryUsage();

  res.json({
    status: dbStatus === 'healthy' ? 'ok' : 'degraded',
    service: 'gatekeeper-automation-server',
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    database: dbStatus,
    workerState: workerManager.getState(),
    scheduler: scheduler.getStatus(),
    system: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
    },
  });
}
