import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { Logger } from './logger.js';
import { getDatabase } from './database/db.js';
import { apiRouter } from './api/routes.js';
import { scheduler } from './scheduler/scheduler.js';
import { npmClient } from './analytics/npmClient.js';

const logger = new Logger('Server');
const app = express();

// Determine directory name safely for ESM/NodeNext
const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// Express Middlewares
app.use(cors());
app.use(express.json());

// Serve static dashboard UI
const publicDir = path.resolve(currentDir, 'dashboard', 'public');
app.use(express.static(publicDir));

// Mount API routes
app.use('/api', apiRouter);

// Fallback to dashboard index.html for UI navigation
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'NotFound', message: `Cannot ${req.method} ${req.path}` });
    return;
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Server Initialization
let server: any = null;

async function bootstrap() {
  try {
    logger.info(`Bootstrapping Gatekeeper Automation Server in [${config.nodeEnv}] mode...`);

    // 1. Initialize Database
    const db = await getDatabase();
    logger.info('Database connection established and schema initialized.');

    // 2. Start Scheduled Tasks
    scheduler.start();

    // 3. Pre-fetch initial analytics in background
    npmClient
      .fetchPackageDetails()
      .then((details) => {
        logger.info(`Monitoring active package: ${details.name} (latest: ${details.latestVersion})`);
      })
      .catch((err) => {
        logger.warn(`Initial package metadata fetch deferred: ${err.message}`);
      });

    // 4. Start HTTP Server
    server = app.listen(config.port, config.host, () => {
      logger.info(`================================================================`);
      logger.info(`🛡️ Gatekeeper Automation & Monitoring Server is RUNNING`);
      logger.info(`   Dashboard: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
      logger.info(`   API Base:  http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/api`);
      logger.info(`   Target:    ${config.packageName}@${config.packageVersion}`);
      logger.info(`================================================================`);
    });
  } catch (err: any) {
    logger.error(`Failed to bootstrap application: ${err.message}`);
    process.exit(1);
  }
}

// Graceful Shutdown Handlers
async function handleShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  scheduler.stop();

  if (server) {
    server.close(() => {
      logger.info('HTTP server closed.');
    });
  }

  try {
    const db = await getDatabase();
    await db.close();
  } catch (err) {}

  logger.info('Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Start server
bootstrap();

export { app };
