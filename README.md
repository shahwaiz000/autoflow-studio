# AutoFlow Studio v0.1

A business workflow automation platform: a FastAPI backend with a real execution engine, a SQLite database, and a React + TypeScript dashboard. Everything is free and runs locally. All data is fictional.

## What works in v0.1

- Dashboard with metrics computed from the database (totals, success rate, average duration, 14-day trend, failure reasons, per-workflow runs)
- Workflow library: search, filter, enable/disable, view steps, run
- Execution engine: ordered steps, conditional branching, per-step retries, per-step logs, durations, error messages
- Execution history and detail pages with step-by-step logs
- Idempotent seed data: 6 fictional workflows, sample CSVs, and 110 historical executions flagged `demo`
- Tests: 12 backend (pytest), 3 frontend (Vitest)

## Not built yet (shown as "Planned" in the sidebar)

Visual workflow builder, creating/editing workflows, CSV upload, analytics page and CSV export, templates, AI assistant, scheduling. Notification steps only write to the log; nothing is emailed.

## Setup on Windows 11

You need **Python 3.11+** and **Node.js 20+** (both free). Check in any terminal: `python --version` and `node --version`.

### Terminal 1: backend (PowerShell, inside the `backend` folder)
```powershell
cd autoflow-studio\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest
python -m uvicorn app.main:app --reload --port 8000
```
If activation is blocked, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
API docs open at http://127.0.0.1:8000/docs. The database and sample CSVs are created on first start.

### Terminal 2: frontend (a second PowerShell, inside the `frontend` folder)
```powershell
cd autoflow-studio\frontend
npm install
npm test
npm run dev
```
Open http://localhost:5173.

## Architecture

```
backend/app/
  main.py       API routes + consistent error format
  engine.py     workflow execution (whitelisted step types, no arbitrary code)
  analytics.py  dashboard metrics from stored executions
  models.py     Workflow, Execution, ExecutionStep (SQLAlchemy)
  seed.py       idempotent fictional data
frontend/src/   pages/, components/, lib.ts (API hook), types.ts
```

Step types: `trigger`, `load_csv`, `validate`, `condition`, `transform`, `notify`, `report`, `end`. Conditions use a fixed operator table (`> >= < <= == !=`); CSV paths are restricted to `backend/data/samples`.

## API

`GET /api/health` - `GET /api/dashboard` - `GET /api/workflows` - `GET|PATCH /api/workflows/{id}` - `POST /api/workflows/{id}/run` - `GET /api/executions` - `GET /api/executions/{id}`

Errors always look like `{"error": {"code": "...", "message": "..."}}`.

## Known limitations

- Runs execute synchronously inside the request (fine for small CSVs; a task queue is the next step for long jobs).
- Dashboard aggregation runs in Python, not SQL; fine for thousands of rows.
- No authentication yet. Do not expose this to the internet.
- `create_all` creates tables but does not migrate; add Alembic before changing models in a real deployment.
