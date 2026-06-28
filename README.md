# 🛡️ Gatekeeper Shell

> A **secure, collaborative, remote terminal wrapper** for your POSIX-style shell. Share your terminal with guests — but you decide what runs.

[![Contributor CI](https://github.com/VishalRaut2106/go-gatekeeper/actions/workflows/ci.yml/badge.svg)](https://github.com/VishalRaut2106/go-gatekeeper/actions/workflows/ci.yml)
[![NPM Version](https://img.shields.io/npm/v/gatekeeper-shell?style=flat-square&logo=npm)](https://www.npmjs.com/package/gatekeeper-shell)
[![Go Version](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go)](https://go.dev/dl/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

---

## 🌟 What Is This?

**Gatekeeper Shell** is a Go-powered secure relay system that wraps your local terminal and exposes it safely to guests.

| Role | Capabilities |
|------|-----------------|
| **Host** | Full terminal ownership. keystone inputs go directly to shell stdin. Approves or denies guest commands before execution. |
| **Guest** | Interactive viewing. Can type commands, which are queued and only run once approved by the host. |

---

## ✨ Features

- **🔒 Host-Gated Execution** — Guests cannot execute commands without host confirmation.
- **⚡ Real-Time WebSockets** — Seamless streaming of stdout/stderr directly to the browser UI.
- **📦 Zero-Install Client** — Run hosts/guests instantly via `npx gatekeeper-shell`.
- **🖥️ Premium Glassmorphic Terminal** — Modern UI with Dark Mode, customized typography, and window layout.
- **📊 Relaying Observability** — Built-in `/health` and `/stats` JSON endpoints on the relay server.
- **🛡️ Provenance Signed** — Verified cryptographic builds published directly to npm registry.

---

## 🚀 Quick Start (Using npm)

To host a session instantly using the pre-compiled binary wrapper:

```bash
npx gatekeeper-shell
```

To run the client as a guest or target a self-hosted relay server:
```bash
# Join a session
npx gatekeeper-shell join <session-code>

# Connect using a custom relay server
npx gatekeeper-shell host --server wss://your-relay-server.com/ws
```

---

## 🛠️ Self-Hosting the Relay Server

If you want to deploy your own secure relay server (e.g. on Render, Fly.io, or Heroku):

### 1. Build and Run Server
```bash
go run ./cmd/server
```
The server starts at `http://localhost:8080` by default.

### 2. Connect CLI Client to Server
```bash
go run ./cmd/cli host --server ws://localhost:8080/ws
```

---

## 📊 Observability

The relay server exposes JSON metrics endpoints for standard health checks and performance monitoring:
* **`GET /health`**: Returns uptime, active session count, total client connections, and application version.
* **`GET /stats`**: Lists metadata on active rooms, including active guest counts and cumulative traffic indicators.

---

## 📁 Repository Structure

```
go-gatekeeper/
├── cmd/
│   ├── cli/            # CLI Client code (connects local terminal to relay)
│   └── server/         # Go WebSocket Relay Server code
├── web/                # Web application (dark terminal interface)
├── npm/                # Binary packaging script for npm distribution
├── render.yaml         # Automated Render deployment definition
├── package.json        # CLI package versioning definitions
└── .github/            # GitHub Actions workflows & templates
```

---

## 🤝 Contributing

Contributions are welcome! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) to get started with local builds, coding style, and PR reviews.

---

## 📜 License

Distributed under the [MIT License](LICENSE).

