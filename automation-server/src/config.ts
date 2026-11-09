import dotenv from 'dotenv';
import path from 'path';

// Load .env file if available
dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  packageName: string;
  packageVersion: string;
  adminApiKey: string;
  testTimeoutMs: number;
  testTempBaseDir: string | undefined;
  workerConcurrencyLimit: number;
  testScheduleCron: string;
  analyticsScheduleCron: string;
  dbType: 'sqlite' | 'postgres';
  sqliteDbPath: string;
  databaseUrl?: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

export function loadConfig(): AppConfig {
  const port = parseInt(process.env.PORT || '4000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const nodeEnv = process.env.NODE_ENV || 'development';
  const packageName =
    process.env.TARGET_PACKAGE_NAME ||
    (process.env.NPM_PACKAGE_NAME && process.env.NPM_PACKAGE_NAME !== 'gatekeeper-automation-server'
      ? process.env.NPM_PACKAGE_NAME
      : 'gatekeeper-shell');
  const packageVersion = process.env.NPM_PACKAGE_VERSION || 'latest';
  const adminApiKey = process.env.ADMIN_API_KEY || 'gatekeeper-secret-key-change-me-in-production';
  const testTimeoutMs = parseInt(process.env.TEST_TIMEOUT_MS || '90000', 10);
  const testTempBaseDir = process.env.TEST_TEMP_BASE_DIR ? path.resolve(process.env.TEST_TEMP_BASE_DIR) : undefined;
  const workerConcurrencyLimit = parseInt(process.env.WORKER_CONCURRENCY_LIMIT || '1', 10);
  const testScheduleCron = process.env.TEST_SCHEDULE_CRON || '0 */6 * * *';
  const analyticsScheduleCron = process.env.ANALYTICS_SCHEDULE_CRON || '0 */3 * * *';
  const dbType = (process.env.DB_TYPE === 'postgres' ? 'postgres' : 'sqlite') as 'sqlite' | 'postgres';
  const sqliteDbPath = process.env.SQLITE_DB_PATH || './data/gatekeeper_monitor.db';
  const databaseUrl = process.env.DATABASE_URL;
  const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
  const rateLimitMaxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);

  return {
    port,
    host,
    nodeEnv,
    packageName,
    packageVersion,
    adminApiKey,
    testTimeoutMs,
    testTempBaseDir,
    workerConcurrencyLimit,
    testScheduleCron,
    analyticsScheduleCron,
    dbType,
    sqliteDbPath,
    databaseUrl,
    rateLimitWindowMs,
    rateLimitMaxRequests,
  };
}

export const config = loadConfig();
