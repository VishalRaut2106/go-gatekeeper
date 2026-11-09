import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { apiRouter } from '../../src/api/routes.js';
import { getDatabase } from '../../src/database/db.js';
import { config } from '../../src/config.js';

describe('API Integration Endpoints', () => {
  let app: express.Express;

  beforeAll(async () => {
    // Initialize in-memory or test database
    await getDatabase();

    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
  });

  afterAll(async () => {
    const db = await getDatabase();
    await db.close();
  });

  it('GET /api/health returns healthy service status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('gatekeeper-automation-server');
    expect(res.body.status).toMatch(/^(ok|degraded)$/);
    expect(res.body).toHaveProperty('uptimeSeconds');
  });

  it('GET /api/package/version returns package details', async () => {
    const res = await request(app).get('/api/package/version');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('gatekeeper-shell');
    expect(res.body).toHaveProperty('latestVersion');
  });

  it('GET /api/tests/history returns history array and stats', async () => {
    const res = await request(app).get('/api/tests/history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stats');
    expect(Array.isArray(res.body.tests)).toBe(true);
  });

  it('GET /api/workers/status returns worker and scheduler state', async () => {
    const res = await request(app).get('/api/workers/status');
    expect(res.status).toBe(200);
    expect(res.body.worker).toHaveProperty('status');
    expect(res.body.scheduler).toHaveProperty('enabled');
  });

  it('POST /api/tests/run rejects unauthorized requests with 401', async () => {
    const res = await request(app)
      .post('/api/tests/run')
      .send({ version: '2.1.2' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('POST /api/tests/run rejects invalid version payloads with 400', async () => {
    const res = await request(app)
      .post('/api/tests/run')
      .set('x-api-key', config.adminApiKey)
      .send({ version: 'invalid; rm -rf /' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });
});
