import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';

export const standardRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Maximum ${config.rateLimitMaxRequests} requests per ${Math.round(config.rateLimitWindowMs / 60000)} minutes.`,
  },
});

export const strictWorkerRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // max 10 test triggers per 5 minutes to prevent spamming
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate Limit Exceeded',
    message: 'Too many test runs triggered recently. Please wait before triggering another manual run.',
  },
});
