# JUNE — Job Unification & Network Execution

JUNE is a governed automation control plane: one place to discover what the platform can automate, run it safely in UAT, watch it live, and move production changes through evidence-bound approval — without opening Jenkins.

This repository contains a working modular monolith: a FastAPI control plane, a PostgreSQL/SQLite persistence layer, an embedded execution engine, and a Next.js application with a dark, high-contrast operator UI.

---

## What works end to end

The first-release journey is implemented, not mocked:

1. **Sign in** with a real session (httpOnly cookies, CSRF double-submit, JWT with token versioning, scrypt password hashes, login rate limits).
2. **Understand JUNE** through the Command Center, plain-English guides on every automation, and a Help Center that explains roles, permissions and the safety model.
3. **Discover an automation** in the registry, read its guide, inputs, pipeline and version history.
4. **Execute safely in UAT** through a three-step governed wizard: environment → typed inputs → live policy preflight → submitted execution.
5. **Watch it live** — real Server-Sent Events stream stage and log lines into the execution detail page.
6. **Read the result honestly** — the UI states what ran, whether it was simulated, the exact candidate hash, artifacts, and the classified failure reason when a run stops.
7. **Follow the approval workflow** — production runs run their evidence stages, pause at an approval gate, and resume only after a *different* authorized approver decides on the exact candidate.

---

## Architecture

```
frontend/  Next.js App Router (TypeScript strict, Tailwind, Motion, TanStack Query,
           Zustand, ECharts, React Flow). /api/* rewrites to the backend.
backend/   FastAPI modular monolith.
             app/api/v1/      HTTP modules (auth, automations, executions, approvals,
                              workflows, security, infrastructure, admin, audit, ...)
             app/services/    domain services (policy, execution, approval, audit,
                              workflow, infrastructure, security, notifications)
             app/engine/      execution state machine + allowlisted runners
             app/models/      SQLAlchemy 2.0 async models
             app/core/        settings, security, events, database, metrics
             alembic/         migrations
```

Design decisions:

- **Modular monolith first.** Clear domain boundaries without the operational cost of microservices.
- **Allowlisted execution only.** Runners are registered in code (`health_check`, `log_audit`, `db_integrity`, `cache_warmup`, `artifact_export`, `secret_sweep`, `config_rollout`). There is no arbitrary shell surface.
- **Adapters, not fiction.** UAT runs use the local sandbox. Production uses the configured `SIMULATION` adapter in this install and labels every result accordingly. Remote agent execution fails closed with `AGENT_CHANNEL_NOT_CONFIGURED` until an authenticated agent exists.
- **Immutable candidates.** A SHA-256 candidate hash binds automation version, workflow checksum, environment, target group and inputs. Approvals are bound to that hash and invalidated if the version or candidate changes.

---

## Local setup

Prerequisites: Python 3.12+, Node.js 22+.

Copy `.env.example` to `.env` and set `JUNE_SECRET_KEY` to a newly generated value
before starting the backend. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
Do not reuse a key that has been committed or shared.

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/Scripts/activate
pip install -r requirements-dev.txt
```

Start the API. Port 8010 is used here to avoid clashing with other local services:

```bash
JUNE_FRONTEND_ORIGIN=http://localhost:3010 \
  .venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

By default the backend uses SQLite (`backend/june.db`) and creates tables without creating demo accounts.
To seed a disposable development database, explicitly set `JUNE_SEED_ON_START=true` and set
`JUNE_SEED_PASSWORD` to a unique password of at least 16 characters. The sample accounts use that
password; do not enable sample seeding or use sample accounts in production.

### Frontend

```bash
cd frontend
npm install
BACKEND_INTERNAL_URL=http://127.0.0.1:8010 npm run dev -- -p 3010
```

Open <http://localhost:3010>.

The API base is rewritten in `next.config.ts`; change `BACKEND_INTERNAL_URL` if your backend runs elsewhere. When the frontend runs on a non-default port, start the backend with the matching `JUNE_FRONTEND_ORIGIN` so the Origin allowlist accepts credentialed requests.

### Demo personas

The sample accounts below are created only when opt-in seeding is enabled. Their password is the
value supplied through `JUNE_SEED_PASSWORD`; it is never included in the repository or login page.

| Email | Role | Typical use |
| --- | --- | --- |
| `ava.chen@june.dev` | Super Administrator | Platform ownership, every capability |
| `marcus.reed@june.dev` | Platform Administrator | Users, roles, environments, infrastructure |
| `priya.nair@june.dev` | Automation Developer | Authoring, workflows, versions |
| `daniel.okafor@june.dev` | Operations Engineer | Production operations and execution |
| `sofia.almeida@june.dev` | Security Reviewer | Scans, findings, security posture |
| `elena.petrova@june.dev` | Approver | Second-party production decisions |
| `jordan.lee@june.dev` | Viewer | Read-only discovery and audit |

---

## The safety model

- **Separation of duties.** A requester can never approve their own production request. Enforced in policy, service layer, API and UI.
- **Evidence before promotion.** Secret and dependency scans plus the UAT deployment and smoke test must succeed *inside the same execution* before the approval gate opens.
- **Candidate-bound approvals.** Approval records store the candidate hash, automation version, workflow version and evidence snapshot. Re-checked immediately before the production deployment stage.
- **Time-boxed decisions.** Pending approvals expire; expired requests block the run rather than silently proceeding.
- **Fail closed.** Unavailable external policy (OPA) blocks promotion. Missing remote agents block remote execution.
- **Append-only Chronicle.** Every login, run, scan, approval and admin change is written to a SHA-256 hash-linked ledger. The Chronicle exposes verification and shows the chain status; there is no update or delete path.
- **Credentials by reference.** Secrets are stored as references and fingerprints, never as plaintext values.

---

## Testing and builds

Backend tests:

```bash
cd backend
.venv/Scripts/python.exe -m pytest -q
```

Frontend type-check and production build:

```bash
cd frontend
npx tsc --noEmit
npm run build
```

---

## Docker Compose

```bash
docker compose up --build
```

- PostgreSQL 16, Redis 7, backend on `:8000`, frontend on `:3000`.
- Set `POSTGRES_PASSWORD` and `JUNE_SECRET_KEY` in `.env` before starting Compose; use a URL-safe PostgreSQL password.
- Generate values with `python -c "import secrets; print(secrets.token_urlsafe(32))"` and put separate values in each variable.
- PostgreSQL and Redis are available only on the internal Compose network; the backend and frontend are exposed on `:8000` and `:3000`.
- Seeding is disabled by default and is rejected in production. To seed a disposable local stack, explicitly set `JUNE_SEED_ON_START=true` and provide `JUNE_SEED_PASSWORD`.
- The frontend image is a multi-stage standalone Next.js build; `BACKEND_INTERNAL_URL=http://backend:8000` is baked in at build time and supplied at runtime.
- For a real deployment, set a strong unique `JUNE_SECRET_KEY`, enable `JUNE_COOKIE_SECURE`, terminate TLS in front of the stack, and provision accounts through a secure onboarding process.

---

## Honest limitations

- **Production is simulated in this install.** No remote execution agent is connected. The UI never presents a simulated run as a live production change.
- **The health-check automation cannot pass against the seeded production group** because every inventory entry there is marked simulated; the run stops with `NO_LIVE_TARGETS` and says so. Use UAT for live probes, or register real endpoints.
- **External integrations are configuration-gated.** Where an integration (OPA, remote agent, secret provider) is not configured, JUNE says so and fails closed instead of pretending.
- **Single-node execution engine.** Executions are scheduled inside the API process; the restart reconciler marks interrupted runs failed rather than leaving them ambiguous. Horizontal scaling would move this into a dedicated worker.

JUNE · Job Unification & Network Execution
