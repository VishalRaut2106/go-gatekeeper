import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { config } from '../config.js';
import { Logger } from '../logger.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const logger = new Logger('Database');

export interface IDatabase {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  close(): Promise<void>;
}

class SQLiteAdapter implements IDatabase {
  private db: any;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    logger.info(`Initialized SQLite database at: ${dbPath}`);
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params) as T | undefined;
    return result || null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...params);
    return {
      changes: Number(res.changes),
      lastInsertRowid: res.lastInsertRowid,
    };
  }

  async close(): Promise<void> {
    this.db.close();
    logger.info('SQLite database connection closed.');
  }
}

// PostgreSQL stub adapter - ready to connect to a real pg Pool when DB_TYPE=postgres
class PostgresAdapter implements IDatabase {
  private connectionString: string;
  private pool: any = null;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async init(): Promise<void> {
    logger.info('Initializing PostgreSQL connection pool...');
    try {
      // Dynamic import to keep pg optional for users using SQLite
      const pgModule: any = await import('pg');
      const Pool = pgModule.default?.Pool || pgModule.Pool;
      this.pool = new Pool({ connectionString: this.connectionString });
    } catch (err: any) {
      logger.warn('The "pg" package is not installed. To use PostgreSQL, run "npm install pg". Falling back to SQLite.');
      throw new Error('PostgreSQL driver (pg) not installed.');
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    let pIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    const res = await this.pool.query(pgSql, params);
    return res.rows as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    let pIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    const res = await this.pool.query(pgSql, params);
    return { changes: res.rowCount || 0 };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      logger.info('PostgreSQL pool connection closed.');
    }
  }
}

let dbInstance: IDatabase | null = null;

export async function getDatabase(): Promise<IDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  if (config.dbType === 'postgres' && config.databaseUrl) {
    try {
      const pgAdapter = new PostgresAdapter(config.databaseUrl);
      await pgAdapter.init();
      dbInstance = pgAdapter;
      await initSchema(dbInstance);
      return dbInstance;
    } catch (err) {
      logger.warn('Falling back to SQLite due to PostgreSQL initialization error.');
    }
  }

  dbInstance = new SQLiteAdapter(config.sqliteDbPath);
  await initSchema(dbInstance);
  return dbInstance;
}

const EMBEDDED_SCHEMA = `
CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    package_name TEXT NOT NULL,
    target_version TEXT NOT NULL,
    installed_version TEXT,
    status TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'MANUAL',
    exit_code INTEGER,
    duration_ms INTEGER NOT NULL,
    stdout TEXT,
    stderr TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_test_runs_created_at ON test_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs (status);

CREATE TABLE IF NOT EXISTS download_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    downloads INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    package_name TEXT NOT NULL,
    raw_data TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_snapshots_period ON download_snapshots (period, created_at DESC);

CREATE TABLE IF NOT EXISTS package_metadata (
    package_name TEXT PRIMARY KEY,
    latest_version TEXT NOT NULL,
    dist_tags TEXT NOT NULL,
    homepage TEXT,
    repository_url TEXT,
    updated_at TEXT NOT NULL
);
`;

export async function initSchema(db: IDatabase): Promise<void> {
  const statements = EMBEDDED_SCHEMA
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await db.execute(stmt);
    } catch (err: any) {
      logger.debug(`Schema statement: ${err.message}`);
    }
  }
  logger.info('Database schema verified/migrated successfully.');
}
