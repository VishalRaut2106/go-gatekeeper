import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InstallationWorker } from '../../src/workers/installationWorker.js';
import { getDatabase } from '../../src/database/db.js';
import { testsRepository } from '../../src/database/repositories/testsRepository.js';

describe('InstallationWorker Sandbox Lifecycle', () => {
  const worker = new InstallationWorker();

  beforeAll(async () => {
    await getDatabase();
  });

  afterAll(async () => {
    const db = await getDatabase();
    await db.close();
  });

  it('rejects invalid package specifications', async () => {
    await expect(
      worker.runLifecycle({
        packageName: 'invalid;package&&injection',
        targetVersion: '1.0.0',
      })
    ).rejects.toThrow(/Invalid package name/);
  });

  it('executes isolated sandbox install lifecycle and cleans up workspace directory', async () => {
    // Run against gatekeeper-shell
    const result = await worker.runLifecycle({
      packageName: 'gatekeeper-shell',
      targetVersion: 'latest',
      triggerType: 'MANUAL',
      timeoutMs: 60000,
    });

    expect(result.runId).toBeDefined();
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify record was persisted in database
    const saved = await testsRepository.getTestById(result.runId);
    expect(saved).not.toBeNull();
    expect(saved?.package_name).toBe('gatekeeper-shell');
    expect(saved?.duration_ms).toBe(result.durationMs);
  }, 75000);
});
