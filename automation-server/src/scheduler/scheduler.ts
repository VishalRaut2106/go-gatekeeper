import cron from 'node-cron';
import { config } from '../config.js';
import { Logger } from '../logger.js';
import { workerManager } from '../workers/workerManager.js';
import { npmClient } from '../analytics/npmClient.js';

const logger = new Logger('Scheduler');

export interface SchedulerStatus {
  enabled: boolean;
  testScheduleCron: string;
  analyticsScheduleCron: string;
  nextScheduledTest: string | null;
  tasksCount: number;
}

export class Scheduler {
  private testTask: cron.ScheduledTask | null = null;
  private analyticsTask: cron.ScheduledTask | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running.');
      return;
    }

    logger.info(`Starting scheduler...`);
    logger.info(`Installation Test Schedule: "${config.testScheduleCron}"`);
    logger.info(`Analytics Sync Schedule:   "${config.analyticsScheduleCron}"`);

    // 1. Installation testing scheduled job
    if (cron.validate(config.testScheduleCron)) {
      this.testTask = cron.schedule(config.testScheduleCron, async () => {
        logger.info('Triggering scheduled installation test worker...');
        try {
          if (!workerManager.isBusy()) {
            await workerManager.runTest({
              triggerType: 'SCHEDULED',
              targetVersion: config.packageVersion,
            });
          } else {
            logger.warn('Skipping scheduled test: worker is currently occupied.');
          }
        } catch (err: any) {
          logger.error(`Scheduled test execution error: ${err.message}`);
        }
      });
    } else {
      logger.error(`Invalid TEST_SCHEDULE_CRON format: "${config.testScheduleCron}"`);
    }

    // 2. npm Analytics sync scheduled job
    if (cron.validate(config.analyticsScheduleCron)) {
      this.analyticsTask = cron.schedule(config.analyticsScheduleCron, async () => {
        logger.info('Triggering scheduled npm download analytics sync...');
        try {
          await Promise.all([
            npmClient.fetchPointDownloads('last-day'),
            npmClient.fetchPointDownloads('last-week'),
            npmClient.fetchPointDownloads('last-month'),
            npmClient.fetchRangeDownloads('last-month'),
            npmClient.fetchPackageDetails(),
          ]);
          logger.info('Scheduled npm analytics sync completed.');
        } catch (err: any) {
          logger.error(`Analytics sync error: ${err.message}`);
        }
      });
    } else {
      logger.error(`Invalid ANALYTICS_SCHEDULE_CRON format: "${config.analyticsScheduleCron}"`);
    }

    this.isRunning = true;
    logger.info('Scheduled tasks initialized successfully.');
  }

  stop(): void {
    if (this.testTask) {
      this.testTask.stop();
      this.testTask = null;
    }
    if (this.analyticsTask) {
      this.analyticsTask.stop();
      this.analyticsTask = null;
    }
    this.isRunning = false;
    logger.info('Scheduler stopped.');
  }

  getStatus(): SchedulerStatus {
    return {
      enabled: this.isRunning,
      testScheduleCron: config.testScheduleCron,
      analyticsScheduleCron: config.analyticsScheduleCron,
      nextScheduledTest: null, // node-cron doesn't natively expose next date without parser
      tasksCount: (this.testTask ? 1 : 0) + (this.analyticsTask ? 1 : 0),
    };
  }
}

export const scheduler = new Scheduler();
