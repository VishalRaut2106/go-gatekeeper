# Contributing to Gatekeeper Shell

Thank you for your interest in contributing to Gatekeeper Shell! As an open-source project, we welcome contributions of all kinds, including bug reports, feature requests, documentation improvements, and code submissions.

---

## Development Environment Setup

To work on Gatekeeper Shell locally, you will need:
- **Go** (version 1.22 or higher)
- **Node.js** (version 20 or higher, for packaging/testing the npm binary wrapper)

### Clone the Repository
```bash
git clone https://github.com/VishalRaut2106/go-gatekeeper.git
cd go-gatekeeper
```

---

## Local Development

The project consists of two components: the **Relay Server** (`cmd/server`) and the **CLI Client** (`cmd/cli`).

### 1. Running the Relay Server
The relay server coordinates WebSockets between the terminal host and guests. Run it locally:
```bash
go run ./cmd/server
```
The server will start on port `8080` by default. You can access the web console at `http://localhost:8080`.

### 2. Running the CLI Client
To start a hosting session connected to your local server:
```bash
go run ./cmd/cli host --server ws://localhost:8080/ws
```

To connect to a session as a guest:
```bash
go run ./cmd/cli join <session-code> --server ws://localhost:8080/ws
```

---

## Submitting Pull Requests

We use automated CI/CD pipelines to ensure the codebase remains stable and secure.

1. **Create a branch** for your edits: `git checkout -b feat/your-feature-name`
2. **Write tests** if you are adding new features.
3. **Verify locally** before pushing:
   ```bash
   go build ./...
   go vet ./...
   go test ./...
   ```
4. **Push and open a PR:** When you open a PR, our GitHub Actions will run automated build checks and perform a professional peer code review using Mistral Codestral. 

---

## Style Guide

- Follow standard Go formatting conventions (`go fmt`).
- Write descriptive, lowercase commit messages prefixed with the scope (e.g., `feat: add session timeout`, `fix: handle connection drop`).
- Ensure all comments and documentation are clear and written in English.
