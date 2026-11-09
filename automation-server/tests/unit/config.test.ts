import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('Config Loader', () => {
  it('should load default configuration settings', () => {
    const config = loadConfig();
    expect(config.port).toBeDefined();
    expect(config.packageName).toBe('gatekeeper-shell');
    expect(config.packageVersion).toBeDefined();
    expect(config.dbType).toMatch(/^(sqlite|postgres)$/);
    expect(config.workerConcurrencyLimit).toBeGreaterThanOrEqual(1);
    expect(config.testTimeoutMs).toBeGreaterThan(0);
  });

  it('should respect custom environment overrides', () => {
    process.env.NPM_PACKAGE_NAME = 'custom-gatekeeper';
    process.env.PORT = '5555';
    const customConfig = loadConfig();
    expect(customConfig.packageName).toBe('custom-gatekeeper');
    expect(customConfig.port).toBe(5555);

    // cleanup
    delete process.env.NPM_PACKAGE_NAME;
    delete process.env.PORT;
  });
});
