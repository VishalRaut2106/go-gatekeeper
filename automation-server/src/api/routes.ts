import { Router } from 'express';
import { getHealth } from './controllers/healthController.js';
import { getDownloadsAnalytics } from './controllers/analyticsController.js';
import { getPackageVersion } from './controllers/packageController.js';
import { getTestsHistory, getTestById, runTest } from './controllers/testsController.js';
import { getWorkersStatus } from './controllers/workersController.js';
import { requireAdminAuth } from './middleware/auth.js';
import { standardRateLimiter, strictWorkerRateLimiter } from './middleware/rateLimit.js';

export const apiRouter = Router();

// Apply standard rate limiting to all API routes
apiRouter.use(standardRateLimiter);

// 1. Health Endpoint
apiRouter.get('/health', getHealth);

// 2. npm Download Analytics Endpoint
apiRouter.get('/analytics/downloads', getDownloadsAnalytics);

// 3. Package Registry Version Metadata Endpoint
apiRouter.get('/package/version', getPackageVersion);

// 4. Test History & Inspection Endpoints
apiRouter.get('/tests/history', getTestsHistory);
apiRouter.get('/tests/:id', getTestById);

// 5. Worker & Schedule Status Endpoint
apiRouter.get('/workers/status', getWorkersStatus);

// 6. Manual Test Trigger Endpoint (Protected with Admin Auth and Strict Worker Rate Limiter)
apiRouter.post('/tests/run', requireAdminAuth, strictWorkerRateLimiter, runTest);
