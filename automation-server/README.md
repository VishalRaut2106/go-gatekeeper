# Gatekeeper npm Package Automation & Growth Monitoring Server

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Gatekeeper](https://img.shields.io/badge/Gatekeeper-v2.1.2-77d49b)](https://gatekeeper.vishalraut.me/)

A production-grade, containerized Node.js & TypeScript automation server designed for the open-source npm package [`gatekeeper-shell`](https://www.npmjs.com/package/gatekeeper-shell), associated with the Go-based [Gatekeeper](https://github.com/VishalRaut2106/go-gatekeeper) zero-trust pair programming terminal sharing tool.

---

## 🌟 Key Features

1. **Automated Sandboxed Installation Testing**
   - **Isolated Worker Lifecycle**: Creates isolated temp directories (`os.tmpdir()` / `/tmp/gatekeeper-workers`) for each test run.
   - **Registry Resolution**: Resolves exact semver from `https://registry.npmjs.org/gatekeeper-shell`.
   - **Safe Installation**: Runs `npm install --no-audit --no-fund --no-package-lock` in the isolated sandbox.
   - **Non-Destructive CLI Smoke Tests**: Validates package files, bin paths, and entry points with execution timeouts.
   - **Guaranteed Cleanup**: Temporary directories and downloaded artifacts are guaranteed to be unlinked even upon failure, timeout, or uncaught exceptions.
   - **Concurrency Limit & Timeout**: Strict mutex lock (default max 1 worker) and 90s timeout prevent CPU or disk thrashing.
   - **Metric Separation**: Sandboxed tests run purely for health verification and do not count toward official registry metrics.

2. **Official npm Download Analytics & Growth Tracking**
   - Integrates `https://api.npmjs.org/downloads/point/` and `/range/` endpoints.
   - Computes daily, 7-day, and 30-day download totals.
   - Historical trend analysis and weekly growth percentage calculation.
   - In-memory cache + persistent database snapshot caching with graceful offline fallbacks.
   - Metric comparison highlighting genuine npm adoption vs automated worker runs.

3. **Developer Monitoring Dashboard**
   - Inspired by Gatekeeper's sleek dark terminal aesthetic (`#161313`, `#77d49b` emerald accent, Space Grotesk & Inter typography).
   - Real-time download trends chart (powered by Chart.js).
   - Live worker status indicator (Pulsing IDLE / TESTING pill).
   - Interactive installation test history table with status badges and execution duration.
   - Standard output / error log inspector modal for deep diagnostic visibility.
   - One-click manual test runner with API-key authentication.

4. **Production DevOps & Security**
   - Multi-stage Docker build running under unprivileged user (`USER node`).
   - Built-in SQLite database (via Node 22 native `node:sqlite`) with optional PostgreSQL configuration.
   - API rate limiting (`express-rate-limit`) and header-based authentication (`ADMIN_API_KEY`).
   - GitHub Actions automated CI testing workflow (`.github/workflows/automation-ci.yml`).

---

## 📐 Architecture & Data Flow

```
                      +---------------------------------------+
                      |          Official npm Registry        |
                      |   - registry.npmjs.org (metadata)     |
                      |   - api.npmjs.org (downloads)         |
                      +-------------------+-------------------+
                                          |
                                          v
+-----------------------+     +-------------------------------+     +-----------------------+
|  Developer Dashboard  | <-> |       Express REST API        | <-> | Database (SQLite/PG)  |
|  - Realtime Charts    |     |   - /api/health               |     |  - test_runs          |
|  - Metric Counters    |     |   - /api/analytics/downloads  |     |  - download_snapshots |
|  - Manual Test Runner |     |   - /api/tests/history        |     |  - package_metadata   |
|  - Log Inspector      |     |   - /api/tests/run (Auth)     |     +-----------------------+
+-----------------------+     +---------------+---------------+
                                              |
                          +-------------------+-------------------+
                          |                                       |
                          v                                       v
               +----------------------+               +-----------------------+
               |  Scheduled Cron Job  |               |  Installation Worker  |
               |   - Tests: 0 */6 *   |               |  - Isolated temp dir  |
               |   - Sync:  0 */3 *   |               |  - npm install test   |
               +----------------------+               |  - Smoke check CLI    |
                                                      |  - Guaranteed cleanup |
                                                      +-----------------------+
```

---

## 📂 Project Structure

```
automation-server/
├── Dockerfile                     # Multi-stage production container with non-root user
├── docker-compose.yml             # Container orchestration and volume persistence
├── package.json                   # Dependencies and npm scripts
├── tsconfig.json                  # TypeScript compiler options (NodeNext / ES2022)
├── vitest.config.ts               # Test runner configuration
├── .env.example                   # Documented configuration template
├── README.md                      # Comprehensive server documentation
├── src/
│   ├── config.ts                  # Typed environment variable loader & defaults
│   ├── logger.ts                  # Structured logging with timestamps and log levels
│   ├── index.ts                   # Express server bootstrap and graceful shutdown
│   ├── api/
│   │   ├── routes.ts              # API routes definition
│   │   ├── middleware/
│   │   │   ├── auth.ts            # API key authentication for protected endpoints
│   │   │   └── rateLimit.ts       # Rate limiters
│   │   └── controllers/
│   │       ├── healthController.ts
│   │       ├── analyticsController.ts
│   │       ├── packageController.ts
│   │       ├── testsController.ts
│   │       └── workersController.ts
│   ├── workers/
│   │   ├── installationWorker.ts  # Isolated sandbox lifecycle, npm install, cleanup
│   │   └── workerManager.ts       # Mutex concurrency limiter and state tracker
│   ├── scheduler/
│   │   └── scheduler.ts           # Cron jobs for test execution and analytics sync
│   ├── analytics/
│   │   ├── npmClient.ts           # npm downloads & registry client with caching
│   │   └── growthCalculator.ts    # Growth percentage, comparisons & trends
│   ├── database/
│   │   ├── db.ts                  # SQLite and PostgreSQL database adapter
│   │   ├── schema.sql             # SQL DDL schemas and indexes
│   │   └── repositories/
│   │       ├── testsRepository.ts
│   │       └── analyticsRepository.ts
│   └── dashboard/
│       └── public/
│           ├── index.html         # Gatekeeper-themed developer dashboard
│           ├── css/dashboard.css  # Dark theme styles
│           └── js/dashboard.js    # Reactive UI, chart updates & test controls
└── tests/
    ├── unit/
    │   ├── config.test.ts
    │   ├── growthCalculator.test.ts
    │   └── npmClient.test.ts
    └── integration/
        ├── api.test.ts
        └── worker.test.ts
```

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- **Node.js**: v22.x or higher
- **npm**: v10.x or higher

### 1. Installation
```bash
cd automation-server
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Key variables in `.env`:
```env
PORT=4000
ADMIN_API_KEY=your-secure-admin-key
TEST_SCHEDULE_CRON="0 */6 * * *"
ANALYTICS_SCHEDULE_CRON="0 */3 * * *"
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Build & Run Production Bundle
```bash
npm run build
npm start
```
Open **[http://localhost:4000](http://localhost:4000)** in your browser to access the dashboard.

---

## 🧪 Automated Testing

The server includes unit and integration tests covering configuration, analytics calculation, npm registry communication, API endpoints, and sandbox worker execution:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## 🐳 Docker & Docker Compose Setup

### Running with Docker Compose (Recommended)
```bash
docker compose up -d --build
```
This starts `gatekeeper-automation-server` on port `4000`, volume mounts `./data` for SQLite persistence, and configures container health checks.

To view logs:
```bash
docker compose logs -f
```

To stop:
```bash
docker compose down
```

---

## 🔌 API Endpoints Reference

All endpoints return JSON responses. Protected endpoints require the `x-api-key: <ADMIN_API_KEY>` or `Authorization: Bearer <ADMIN_API_KEY>` header.

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | System status, DB connectivity, worker state, uptime |
| `GET` | `/api/analytics/downloads` | Public | Official npm downloads (day, week, month), trends, growth % |
| `GET` | `/api/package/version` | Public | Latest version, dist-tags, and repository metadata |
| `GET` | `/api/tests/history` | Public | Paginated history of sandboxed test runs and stats |
| `GET` | `/api/tests/:id` | Public | Detailed log inspection (stdout, stderr, exit code) for a test |
| `GET` | `/api/workers/status` | Public | Current worker state (IDLE / RUNNING) and scheduler config |
| `POST` | `/api/tests/run` | **Protected** | Trigger a sandboxed installation test run |

### Example: Triggering a Test Run via cURL
```bash
curl -X POST http://localhost:4000/api/tests/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secure-admin-key" \
  -d '{"version": "latest"}'
```

### Example: Health Check Response
```json
{
  "status": "ok",
  "service": "gatekeeper-automation-server",
  "timestamp": "2026-10-18T20:45:00.000Z",
  "uptimeSeconds": 128,
  "database": "healthy",
  "workerState": {
    "status": "IDLE",
    "currentTask": null,
    "lastRunAt": "2026-10-18T20:44:46.999Z",
    "lastRunStatus": "SUCCESS",
    "concurrencyLimit": 1
  },
  "scheduler": {
    "enabled": true,
    "testScheduleCron": "0 */6 * * *",
    "analyticsScheduleCron": "0 */3 * * *"
  }
}
```

---

## 🛡️ Reliability & Security Assurance

1. **Non-Root Execution**: Docker container runs as the `node` user with minimal POSIX privileges.
2. **Temporary Sandbox Isolation**: Tests run in unique temporary directories (`os.tmpdir()` / `/tmp/gatekeeper-workers`) that are completely deleted after execution.
3. **No Metric Fabrication**: Local installation tests use `--no-audit --no-fund --no-package-lock` and do not generate artificial registry download counts.
4. **Command Injection Prevention**: Package names and version parameters are validated with strict regex patterns (`^[0-9a-zA-Z\.\-\+]+$`). Arguments are passed directly as array arguments to `child_process.spawn`.
5. **Worker Concurrency Limit**: Mutex lock ensures only one installation worker executes at any time, returning `409 WorkerBusy` if saturated.
6. **Execution Timeouts**: Installation jobs abort after `TEST_TIMEOUT_MS` (default 90 seconds) to prevent frozen processes from exhausting server memory.

---

## ☁️ Cost-Conscious Cloud Deployment

This automation server is designed with lightweight resource consumption (~60MB RSS memory with Node 22 native SQLite), making it ideal for free or ultra-low-cost hosting:

### Option 1: Render (Recommended & Matches Existing Gatekeeper Infrastructure)
1. In your Render Dashboard, click **New +** -> **Web Service**.
2. Connect your repository and set the **Root Directory** to `automation-server`.
3. Select **Docker** as the Runtime (or **Node** with build command `npm install && npm run build` and start command `npm start`).
4. Attach a small **Persistent Disk** mounted at `/app/data` (1GB is more than enough for years of history).
5. Set environment variables:
   - `ADMIN_API_KEY`: Generate a random secret.
   - `NODE_ENV`: `production`.
6. Cost: **Free tier** ($0/month) or Starter ($7/month if using persistent disk).

### Option 2: Railway
1. Click **New Project** -> **Deploy from GitHub repo**.
2. Select repository, configure root directory as `automation-server`.
3. Add a Volume mounted at `/app/data`.
4. Cost: **$5/month hobby credit** covers the entire footprint with zero out-of-pocket cost.

### Option 3: Fly.io
```bash
cd automation-server
fly launch --name gatekeeper-monitor
fly volumes create gatekeeper_data --size 1
# Update fly.toml to mount gatekeeper_data at /app/data
fly deploy
```
Cost: **Free tier** ($0/month within Fly's free 3 shared-cpu-1x 256MB VM allocation).

### Option 4: Hetzner / DigitalOcean VPS ($3–$4/mo)
Run via Docker Compose:
```bash
git clone https://github.com/VishalRaut2106/go-gatekeeper.git
cd go-gatekeeper/automation-server
cp .env.example .env
docker compose up -d
```
Reverse-proxy via Nginx or Caddy with automated HTTPS (`Caddyfile: monitor.vishalraut.me -> reverse_proxy localhost:4000`).

---

## 📄 License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).
