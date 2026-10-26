# AutoFlow Studio

A business workflow automation platform. You build workflows from simple steps, run them, and watch the results. Everything runs locally and uses free tools. **All data in this project is fictional.**

> Status: v0.6, work in progress. The sections below say exactly what works and what does not.

## What works today

- **Dashboard.** An automation health view (success ring, runs per day), week-over-week stat cards, average run time per day, a failure summary, workflow status with success bars, recent activity, and quick actions to run a workflow or upload a CSV. All numbers come from the database. "Estimated time saved" is only calculated from a manual time per run that you type in; nothing is assumed.
- **Workflow library.** Search, filter, enable or disable, view steps, and run a workflow. Running starts real processing on the backend.
- **Drag-and-drop builder.** Drag steps onto a canvas, draw arrows between them, click a box to change its settings, and save. A drawing is checked before saving (one Trigger, no loose ends). Built with React Flow (MIT license).
- **Form editor.** The same workflows can also be edited with a plain form. Add steps, reorder them, set retries, and branch with an if/else condition.
- **Excel and several tables (Phase 1).** A Load step reads a CSV or an .xlsx sheet into a named table, and a workflow can hold more than one table at once. Later steps say which table they work on. Excel files are checked before opening (size, real .xlsx, zip size). Only .xlsx is supported, not the old .xls.
- **Choose files when you run.** A Load step can be set to "choose the file when the workflow runs". Clicking Run then asks for a file for each slot (from Data Sources, or add one on the spot). The files each run used are saved with the run. Scheduled runs skip such workflows and say why, because nobody is there to choose. Saved workflows can also point at one of your uploads.
- **Tidy-up for messy data.** Cleaning options turn amounts like "SAR 1,234.50" or "(500.00)" into numbers, make dates one format (day first by default, and dates already written as 2026-10-06 are never flipped), and tidy names (trim, single spaces, capitals). Anything it cannot read is left empty and counted in the run log, never guessed. A fictional messy sample file and a template show it.
- **Real report.** The report step writes a column-by-column summary, the cleaned data, and an Excel workbook (Summary, Columns, Data) that you can download from the run. Text that looks like a formula is neutralised in the workbook.
- **Execution engine.** Runs steps in order, follows branches, retries failed steps, and records every step with its time and message. Only a fixed list of step types can run, so no user-written code is ever executed.
- **Flow diagrams.** Every workflow is drawn as boxes and arrows, with true/false branches. On a run's page the path that run took is colored.
- **Templates.** Six ready-made workflows. One click makes your own editable copy.
- **Execution history.** Every run with status, duration, trigger, error message and a step-by-step log.
- **CSV upload and cleaning.** Upload a CSV or Excel file (max 5 MB, first sheet). The app finds missing values, duplicates and text where numbers should be, cleans the file, and offers the cleaned file and a summary for download.
- **Analytics.** Volume and duration charts, workflow comparison, common failure reasons, and a CSV export. A filter separates seeded demo data from your own runs.
- **Assistant (rules-based).** Describe a workflow in plain English and get a proposed workflow built only from the engine's own step types, with the reason for each step and warnings about anything it cannot do. It can also explain an existing workflow in plain words with improvement ideas, and summarize why runs failed with advice. It is **not an AI language model**: it follows keyword rules, is free, and works offline. Nothing is saved until you click save.
- **Schedules.** Run a workflow every few minutes (5 or more), every day, or every week at a time on your computer's clock. A small background thread inside the backend checks every 20 seconds. Runs are recorded as "schedule" runs. A page shows the next and last run, and says honestly whether the scheduler is running. Schedules only run while the backend is running, and a run missed while it was off is done once on start-up, not repeated.
- **Data Sources.** One page lists the CSV and Excel files workflows can read: the fictional sample files and your uploads. For each file it shows rows, columns, size and which workflows use it. You can add files, see Excel sheet names, preview the first rows and delete your own uploads. Uploads keep their original name for display but are stored under random names. Sample files cannot be deleted.
- **Login.** The whole API is locked until you log in. The first time the app opens, you create one owner account (username, and a password of 10+ characters with a capital letter and a number). Passwords are hashed with scrypt, sessions are random tokens whose hash is stored, the cookie is HttpOnly, five wrong passwords lock that name for 10 minutes, changing the password logs out other devices, and changes sent from an unknown website are refused. It is built for one owner on a trusted computer: there are no roles, no password reset by email, and you should still serve it over HTTPS (and set AUTH_COOKIE_SECURE=true) before putting it on the internet. Set AUTH_ENABLED=false to turn login off.
- **Background runs.** Clicking Run on the Workflows page puts the run in a queue and returns at once, so the page never freezes. One worker runs the waiting workflows one after another. The run shows as queued, then running, then success or failed, and the page updates itself. The queue is held in memory: if the backend restarts, runs that were waiting or running are marked failed with a clear message instead of staying busy forever. CSV uploads and the Assistant's "save and run" still run inside the request.
- **Reconciliation (Phase 2).** A Compare step matches two tables on a key column (for example waybill against bank reference), then checks that the amounts agree within an allowed difference. Everything that does not agree becomes an exception with a reason in plain words: amount differs, missing in either table, duplicate key, unreadable amount, empty key. The run page shows totals and the exception list with a filter and a CSV download, and the Excel report gets an Exceptions sheet. Up to 5,000 exceptions per run are stored. The "COD Reconciliation" template and two fictional sample files (courier_collections.csv, bank_deposits.csv, with 7 planted differences) show it working. The assistant can build this workflow for that file pair.
- **Matching rule.** Matching is one row to one row. A deposit that covers many parcels is not supported yet, and a duplicate key is flagged rather than matched twice.
- **Tests.** 163 backend tests (pytest) and 73 frontend tests (Vitest).

## Not built yet

Reviewing and approving exceptions (Phase 3), many-to-one matching, approvals and an audit trail, a language-model assistant (the current assistant is rule-based), multiple users and roles. Notification steps only write to the log. Nothing is emailed. The old .xls format is not supported.

## Technology (all free)

React, TypeScript, Vite, Tailwind CSS, Recharts, React Flow, Python, FastAPI, SQLAlchemy, SQLite, Pandas, pytest, Vitest.

## Run it on Windows 11

You need Python 3.12 or 3.13 and Node.js 20 or newer. Use two PowerShell windows and run the commands one at a time.

**Window 1: backend**
```powershell
cd autoflow-studio\backend
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest
python -m uvicorn app.main:app --port 8000
```

**Window 2: frontend**
```powershell
cd autoflow-studio\frontend
npm install
npm test
npm run dev
```

Open http://localhost:5173. The API documentation is at http://127.0.0.1:8000/docs.

## How it is built

```
backend/app/
  main.py         API routes and a consistent error format
  engine.py       workflow execution (whitelisted step types)
  definitions.py  checks every workflow the editor saves
  analytics.py    dashboard and analytics numbers, CSV export
  assistant.py    rules-based assistant: propose, explain, failure insights
  schedules.py    schedules and the background scheduler thread
  runqueue.py     in-memory background run queue with one worker
  datasources.py  lists, previews and deletes CSV files safely
  auth.py         password hashing, sessions, login limits
  models.py       Workflow, Execution, ExecutionStep, ExecutionInput tables
  tables.py       reading CSV and Excel files, and cleaning amounts, dates and text
  seed.py         fictional sample data (safe to run many times)
  templates.py    ready-made workflow templates
  reconcile.py    the matching logic behind the Compare step
frontend/src/
  pages/          Dashboard, Workflows, Builder, Editor, Templates, Executions, Analytics, Upload, Assistant, Schedules, Data Sources, Account
  flow.ts         layout and checks for the flow diagrams and the builder
  components/     shared UI and the flow diagram
```

## Safety choices

- Workflows are data, not code. Unknown step types and settings are rejected.
- CSV files are read only from fixed folders, and uploads are stored under random names.
- Uploads are limited by type, size (5 MB) and row count (50,000).
- Exported CSV files neutralise text that Excel could treat as a formula.

## Known limitations

- The background queue lives in memory and has one worker. For many users or very long jobs, use a real job system (for example Celery or RQ with Redis).
- Login is for one owner only. Do not put this on the internet without HTTPS.
- The database has no migration tool yet. Add one (Alembic) before changing tables on real data.

## Screenshots

**Dashboard.** Automation health, runs per day, week-over-week stat cards and quick actions. Every number is calculated from stored executions.

![Dashboard](docs/screenshots/dashboard.png)

**Dashboard, lower half.** Workflow status with success bars, a failure summary, and recent activity.

![Dashboard activity](docs/screenshots/dashboard-activity.png)

**Workflow library.** Run, edit, enable or disable workflows.

![Workflows](docs/screenshots/workflows.png)

**Execution log.** Every step of a run, with timing and error messages.

![Execution log](docs/screenshots/execution-log.png)

**Analytics.** Volume, duration, workflow comparison and failure reasons.

![Analytics](docs/screenshots/analytics.png)

**Drag-and-drop builder.** Drag steps onto the canvas, draw arrows, and edit a box's settings on the right.

![Builder](docs/screenshots/builder.png)

**Flow of a run.** The diagram colors the path a run took.

![Flow diagram](docs/screenshots/flow-diagram.png)

All data shown is fictional.
