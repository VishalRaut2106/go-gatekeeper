-- Database Schema for Gatekeeper Package Automation & Growth Monitoring Server

CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    package_name TEXT NOT NULL,
    target_version TEXT NOT NULL,
    installed_version TEXT,
    status TEXT NOT NULL, -- 'SUCCESS', 'FAILURE', 'TIMEOUT'
    trigger_type TEXT NOT NULL DEFAULT 'MANUAL', -- 'SCHEDULED', 'MANUAL'
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
    period TEXT NOT NULL, -- 'last-day', 'last-week', 'last-month', 'range'
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
