import { Request, Response } from 'express';
import { workerManager } from '../../workers/workerManager.js';
import { scheduler } from '../../scheduler/scheduler.js';

export async function getWorkersStatus(req: Request, res: Response): Promise<void> {
  const workerState = workerManager.getState();
  const schedulerState = scheduler.getStatus();

  res.json({
    worker: workerState,
    scheduler: schedulerState,
    timestamp: new Date().toISOString(),
  });
}
