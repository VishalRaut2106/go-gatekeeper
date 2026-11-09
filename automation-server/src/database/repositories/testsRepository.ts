import { getDatabase } from '../db.js';

export interface TestRun {
  id: string;
  package_name: string;
  target_version: string;
  installed_version?: string | null;
  status: 'SUCCESS' | 'FAILURE' | 'TIMEOUT';
  trigger_type: 'SCHEDULED' | 'MANUAL';
  exit_code?: number | null;
  duration_ms: number;
  stdout?: string | null;
  stderr?: string | null;
  error_message?: string | null;
  created_at: string;
}

export interface TestStats {
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  timeoutRuns: number;
  successRate: number; // percentage 0-100
  averageDurationMs: number;
  lastSuccessfulTest: TestRun | null;
  lastFailedTest: TestRun | null;
}

export class TestsRepository {
  async saveTestRun(run: TestRun): Promise<void> {
    const db = await getDatabase();
    const sql = `
      INSERT INTO test_runs (
        id, package_name, target_version, installed_version, status,
        trigger_type, exit_code, duration_ms, stdout, stderr,
        error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.execute(sql, [
      run.id,
      run.package_name,
      run.target_version,
      run.installed_version ?? null,
      run.status,
      run.trigger_type,
      run.exit_code ?? null,
      run.duration_ms,
      run.stdout ?? null,
      run.stderr ?? null,
      run.error_message ?? null,
      run.created_at,
    ]);
  }

  async getRecentTests(limit: number = 20, offset: number = 0, status?: string): Promise<TestRun[]> {
    const db = await getDatabase();
    if (status) {
      return db.query<TestRun>(
        'SELECT * FROM test_runs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [status, limit, offset]
      );
    }
    return db.query<TestRun>(
      'SELECT * FROM test_runs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
  }

  async getTestById(id: string): Promise<TestRun | null> {
    const db = await getDatabase();
    return db.queryOne<TestRun>('SELECT * FROM test_runs WHERE id = ?', [id]);
  }

  async getTestStats(): Promise<TestStats> {
    const db = await getDatabase();
    const all = await db.query<TestRun>('SELECT * FROM test_runs ORDER BY created_at DESC');

    const totalRuns = all.length;
    if (totalRuns === 0) {
      return {
        totalRuns: 0,
        successRuns: 0,
        failureRuns: 0,
        timeoutRuns: 0,
        successRate: 0,
        averageDurationMs: 0,
        lastSuccessfulTest: null,
        lastFailedTest: null,
      };
    }

    const successRuns = all.filter((r) => r.status === 'SUCCESS').length;
    const failureRuns = all.filter((r) => r.status === 'FAILURE').length;
    const timeoutRuns = all.filter((r) => r.status === 'TIMEOUT').length;
    const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0;
    const totalDuration = all.reduce((acc, curr) => acc + (curr.duration_ms || 0), 0);
    const averageDurationMs = Math.round(totalDuration / totalRuns);

    const lastSuccessfulTest = all.find((r) => r.status === 'SUCCESS') || null;
    const lastFailedTest = all.find((r) => r.status === 'FAILURE' || r.status === 'TIMEOUT') || null;

    return {
      totalRuns,
      successRuns,
      failureRuns,
      timeoutRuns,
      successRate,
      averageDurationMs,
      lastSuccessfulTest,
      lastFailedTest,
    };
  }
}

export const testsRepository = new TestsRepository();
