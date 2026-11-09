import { installationWorker, InstallationTestOptions, WorkerExecutionResult } from './installationWorker.js';
import { Logger } from '../logger.js';
import { testsRepository } from '../database/repositories/testsRepository.js';

const logger = new Logger('WorkerManager');

export type WorkerStatus = 'IDLE' | 'RUNNING';

export interface RunningTaskInfo {
  runId: string;
  startTime: string;
  targetVersion: string;
  triggerType: 'SCHEDULED' | 'MANUAL';
}

export interface WorkerState {
  status: WorkerStatus;
  currentTask: RunningTaskInfo | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  concurrencyLimit: number;
}

export class WorkerManager {
  private status: WorkerStatus = 'IDLE';
  private currentTask: RunningTaskInfo | null = null;
  private lastRunAt: string | null = null;
  private lastRunStatus: string | null = null;
  private activeWorkers = 0;
  private concurrencyLimit = 1;

  constructor(limit = 1) {
    this.concurrencyLimit = limit;
  }

  isBusy(): boolean {
    return this.activeWorkers >= this.concurrencyLimit;
  }

  getState(): WorkerState {
    return {
      status: this.status,
      currentTask: this.currentTask,
      lastRunAt: this.lastRunAt,
      lastRunStatus: this.lastRunStatus,
      concurrencyLimit: this.concurrencyLimit,
    };
  }

  async runTest(options: InstallationTestOptions = {}): Promise<WorkerExecutionResult> {
    if (this.isBusy()) {
      const msg = `Worker is currently busy with task ${this.currentTask?.runId}. Please wait for it to finish.`;
      logger.warn(msg);
      throw new Error(msg);
    }

    this.activeWorkers++;
    this.status = 'RUNNING';
    const startTimeIso = new Date().toISOString();
    this.currentTask = {
      runId: 'pending',
      startTime: startTimeIso,
      targetVersion: options.targetVersion || 'latest',
      triggerType: options.triggerType || 'MANUAL',
    };

    try {
      logger.info(`Acquired worker slot. Starting test execution...`);
      const result = await installationWorker.runLifecycle(options);
      this.lastRunAt = new Date().toISOString();
      this.lastRunStatus = result.success ? 'SUCCESS' : 'FAILURE';
      return result;
    } finally {
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.status = this.activeWorkers > 0 ? 'RUNNING' : 'IDLE';
      this.currentTask = null;
    }
  }
}

export const workerManager = new WorkerManager();
