import { describe, it, expect } from 'vitest';
import { NpmClient } from '../../src/analytics/npmClient.js';

describe('NpmClient', () => {
  const client = new NpmClient();

  it('fetches real metadata for gatekeeper-shell package from npm registry', async () => {
    const details = await client.fetchPackageDetails('gatekeeper-shell');
    expect(details.name).toBe('gatekeeper-shell');
    expect(details.latestVersion).toBeDefined();
    expect(details.distTags).toHaveProperty('latest');
  });

  it('fetches real download count points from npm downloads API', async () => {
    const point = await client.fetchPointDownloads('last-month', 'gatekeeper-shell');
    expect(point.package).toBe('gatekeeper-shell');
    expect(point.downloads).toBeGreaterThanOrEqual(0);
    expect(point.start).toBeDefined();
    expect(point.end).toBeDefined();
  });
});
