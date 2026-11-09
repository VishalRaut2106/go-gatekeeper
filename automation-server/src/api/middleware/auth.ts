import { Request, Response, NextFunction } from 'express';
import { config } from '../../config.js';

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  let token: string | undefined;

  if (apiKeyHeader) {
    token = apiKeyHeader;
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token || token !== config.adminApiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'A valid admin API key is required to perform this action. Provide it via "x-api-key" or "Authorization: Bearer <token>" header.',
    });
    return;
  }

  next();
}
