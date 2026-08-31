# 🛡️ QueryGuard

> **High-performance, zero-code-change PostgreSQL wire-protocol proxy, $N+1$ query cascade detector, sequential table scan analyzer, and automated index advisor for Node.js/TypeScript and CI/CD environments.**

[![CI](https://github.com/Adib23704/QueryGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/Adib23704/QueryGuard/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@adib23704/queryguard.svg)](https://www.npmjs.com/package/@adib23704/queryguard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## Why QueryGuard?

Modern ORMs (Prisma, Drizzle, TypeORM, Sequelize) make data modeling effortless during development, but frequently introduce catastrophic performance anti-patterns into production:

- **$N+1$ Query Cascades:** Running hundreds of repetitive queries inside loops instead of batched fetches (`WHERE id IN (...)`).
- **Unindexed Sequential Scans:** Executing `SELECT` queries against tables with thousands of rows without matching indexes on filtered columns.
- **Redundant Duplicate Queries:** Repeating identical queries with identical parameters multiple times within the same request lifecycle.

Existing monitoring tools require invasive application wrappers or heavyweight APM agents. **QueryGuard operates at the PostgreSQL TCP wire-protocol layer (3.0)** during test runs or CI/CD pipelines with **zero application code changes**.

---

## Architecture & How It Works

```
                     +--------------------------------------------------------+
                     |                 npx queryguard exec                    |
                     |                                                        |
                     |  1. Spawns QueryGuard TCP Proxy on localhost:5433       |
                     |  2. Injects rewritten DATABASE_URL into child process  |
                     |  3. Spawns test suite (e.g. `pnpm test`)               |
                     +---------------------------+----------------------------+
                                                 |
                            [Client Connections] |
                                                 v
                     +--------------------------------------------------------+
                     |                 QueryGuard Proxy Core                  |
                     |  - TCP Wire-Level Stream Interceptor (Port 5433)       |
                     |  - PostgreSQL 3.0 Frame Parser (Simple & Extended)     |
                     |  - High-Throughput Bidirectional Socket Bridge         |
                     +---------------------------+----------------------------+
                                                 |
                          +----------------------+----------------------+
                          |                                             |
                          v                                             v
         +----------------------------------+          +----------------------------------+
         |      Real PostgreSQL Server      |          |        Diagnostic Engine         |
         |         (localhost:5432)         |          |  - Deterministic SHA-256 Hasher  |
         +----------------------------------+          |  - Connection Session Grouping   |
                                                       |  - N+1 Cascade Matcher           |
                                                       |  - Active EXPLAIN Index Advisor  |
                                                       +----------------+-----------------+
                                                                        |
                                                                        v
                                                       +----------------------------------+
                                                       |         Report Formats           |
                                                       |  - Colorized Terminal Table      |
                                                       |  - GitHub PR Comment Markdown    |
                                                       |  - Standalone HTML Waterfall     |
                                                       |  - Structured JSON Output        |
                                                       +----------------------------------+
```

---

## Quickstart

### 1. Run with your test suite (Zero Code Changes)

Wrap your existing test command with `queryguard exec`:

```bash
# Using npx
npx queryguard exec -- pnpm test

# Using npm / yarn / bun
npx queryguard exec -- npm test
npx queryguard exec -- yarn test
npx queryguard exec -- bun test
```

QueryGuard will:
1. Bind a transparent TCP proxy to `localhost:5433`.
2. Rewrite `DATABASE_URL` to point to the proxy.
3. Forward all traffic to your target PostgreSQL server while recording millisecond-accurate query traces.
4. Output a colorized performance summary table on test completion.

### 2. Standalone Trace File Analysis

Analyze an exported query trace offline:

```bash
npx queryguard analyze --file .queryguard/traces.json --db-url postgresql://postgres:password@localhost:5432/mydb
```

---

## Report Formats

### 1. Terminal Output
Instant ANSI-colorized table displaying captured queries, latency waste, N+1 cascades, and index suggestions right in your terminal.

### 2. GitHub Actions PR Comment (Markdown)
Automatically posts a formatted diagnostic comment on pull requests with collapsible `<details>` blocks for each query regression.

### 3. Standalone Interactive HTML Waterfall
Zero-external-dependency, self-contained HTML dashboard featuring:
- **KPI Grid:** Total queries, unique signatures, total query duration, and wasted latency.
- **Execution Waterfall Timeline:** Color-coded execution bars (Cyan = normal, Yellow = duplicate, Red = N+1 cascade).
- **Searchable Query Table:** Instant full-text filtering by SQL, table, or parameters.
- **Index Advisor:** Copy-to-clipboard `CREATE INDEX CONCURRENTLY` DDL suggestions.

---

## GitHub Actions CI Integration

Add QueryGuard to your pull request workflow to block regressions before merging:

```yaml
name: Test Suite & Performance Gate

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: password
          POSTGRES_DB: app_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/setup@v1
        with:
          version: 11
          runtime: node@24
          cache: true

      - run: pnpm install

      - name: Run QueryGuard Performance Gate
        uses: Adib23704/QueryGuard@v1.0.0
        env:
          DATABASE_URL: postgres://postgres:password@localhost:5432/app_test
        with:
          command: "pnpm test"
          fail_on_n_plus_one: "true"
          fail_on_seq_scan: "false"
          markdown_report: ".queryguard/report.md"
          html_report: ".queryguard/report.html"
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

---

## CLI Reference

### `queryguard exec [options] -- <command...>`

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-p, --port <number>` | Port for local TCP proxy to bind | `5433` |
| `--db-url <url>` | Target PostgreSQL database connection string | `env.DATABASE_URL` |
| `--fail-on-n-plus-one` | Exit with code 1 if N+1 query cascades are detected | `false` |
| `--fail-on-seq-scan` | Exit with code 1 if sequential scans on large tables occur | `false` |
| `--n-plus-one-threshold <number>` | Minimum repetitive queries to flag N+1 cascade | `5` |
| `--seq-scan-threshold <number>` | Estimated row threshold to flag sequential scans | `100` |
| `--html-report <path>` | File path to write standalone interactive HTML report | - |
| `--markdown-report <path>` | File path to write GitHub PR comment markdown report | - |
| `--json-report <path>` | File path to export structured JSON report | - |
| `--silent` | Suppress terminal summary table output | `false` |
| `--verbose` | Enable internal proxy diagnostic logging | `false` |

---

## Programmatic TypeScript Library API

QueryGuard can also be used as a TypeScript library in custom test harnesses:

```typescript
import { ProxyServer, analyzeTraces, renderTerminalReport, renderHtmlReport } from "@adib23704/queryguard";

// 1. Start the proxy
const proxy = new ProxyServer({
  targetHost: "localhost",
  targetPort: 5432,
  proxyPort: 5433,
});

await proxy.start();

// 2. Run your integration workload...

// 3. Stop proxy and analyze captured traces
await proxy.stop();

const result = await analyzeTraces(proxy.getTraces(), proxy.getSessions(), {
  nPlusOneThreshold: 5,
  seqScanRowThreshold: 100,
  dbUrl: "postgresql://postgres:password@localhost:5432/mydb",
  enableExplain: true,
});

// 4. Output reports
console.log(renderTerminalReport(result));
```

---

## Supported Frameworks & ORMs

QueryGuard intercepts traffic at the network socket layer, making it compatible with all PostgreSQL clients:

- **Prisma**
- **Drizzle ORM**
- **TypeORM**
- **Kysely**
- **Knex.js**
- **Sequelize**
- **MikroORM**
- **node-postgres (`pg`)**
- **postgres.js (`postgres`)**

---

## License

MIT © [Adib23704](https://github.com/Adib23704)
