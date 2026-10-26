# AutoFlow Studio: interview guide

Written for Shahwaiz. Read it out loud a few times. Every claim below is true of the code in this repo. If an interviewer asks about something not listed here, say what you know and what you would check.

## The 30-second pitch

"AutoFlow Studio automates the reconciliation I do every day at work: matching courier cash-on-delivery collections against bank deposits. You give it the two files, it matches every waybill to its bank reference, compares the amounts, and gives back a short list of exceptions, each with a plain reason: missing deposit, amount differs, duplicate, and so on. It runs on a schedule, keeps a history of every run, and produces an Excel report. Under the hood it is a small workflow engine, so the same steps can be rearranged for other matching jobs. All the data in it is fictional."

## The 2-minute version (if they say "tell me more")

1. **The problem.** Finance teams compare two lists by hand every day (what couriers collected against what reached the bank), and differences get missed. The tool finds every difference and explains it, so people only review what is wrong.
2. **What it does.** A Compare step with exceptions and reasons, Excel and CSV reports, an overview of the latest reconciliation, run history with a flow diagram, schedules, files chosen at run time, a drag-and-drop builder for custom rules, login, a background queue, and a rules-based assistant that builds reconciliation workflows.
3. **How it is built.** React + TypeScript on the front, FastAPI + SQLAlchemy + SQLite + Pandas on the back. Workflows are stored as JSON data, and the engine only runs a fixed list of step types.
4. **How I checked it.** 164 backend tests and 76 frontend tests, plus I ran the real server and tried the features end to end.
5. **What it is not.** A single-owner local tool. It is not ready for the internet or many users, and I know why (see "Limits").

## How a run works (draw this on a whiteboard)

```
Run clicked -> queued -> worker picks it up -> status "running"
  -> step 1 trigger -> step 2 load CSV -> step 3 validate
  -> condition (if/else) -> branch A: notify  /  branch B: skip
  -> report -> end -> status "success" or "failed"
```

Each step is saved with its time, number of attempts and a message. A failed step can retry. The engine stops after 50 steps, so a loop cannot run forever.

## Design choices you can defend

- **Workflows are data, not code.** The editor saves JSON. `clean_definition` rejects anything unknown, and the engine only has handlers for 8 step types. So nobody can make the server run arbitrary code through a workflow. This is the most important safety decision.
- **Everything the assistant proposes goes through the same check as the editor.** It cannot make a workflow the engine cannot run, and nothing is saved until the user clicks.
- **Real numbers only.** The overview computes everything from stored reconciliation results. I removed the randomly generated demo history and the unrelated demo workflows, because made-up numbers on a dashboard mislead.
- **The right answer is known.** The sample files have 7 planted differences, so the tests can check that matching finds exactly 55 matches and those 7 exceptions.
- **Uploads are stored under random names**, limited to 5 MB and 50,000 rows, and exported CSV cells are neutralised so Excel does not treat text as a formula.
- **Login.** Passwords hashed with scrypt, session tokens stored only as hashes, HttpOnly cookie, lockout after 5 wrong tries, requests from unknown websites refused.
- **Decisions are traceable.** Approving or rejecting an exception records who, when and why in an append-only audit table. Rejecting requires a note, deciding twice changes nothing, and an exception from another run cannot be decided by mistake.
- **Schedules never pile up.** If the backend was off for three days, a missed run happens once, not 864 times.
- **Restarts are handled honestly.** Runs left "queued" or "running" by a restart are marked failed with a reason instead of looking busy forever.

## Likely questions, with honest answers

**Why did you build this?**
I work in finance and data. I wanted to learn automation by building something real, and I wanted a portfolio project that shows both the data side and the software side.

**Did you use AI to build it?**
Yes. I built it with Claude as a coding partner. I decided what to build, tested it on my own computer, found and reported problems (for example setup errors and a stale server), and I can explain how each part works. I would say that openly. (Be ready to explain any part you are asked about. Re-read the sections above before an interview.)

**Is the assistant an AI model?**
No, and the app says so on the page. It follows keyword rules: it finds the dataset, the checks and the actions in a sentence and builds a workflow from the engine's own step types. I did that on purpose so it is free, works offline, and cannot invent steps. The design lets a language model be added later, but that is not built.

**How would you add a real AI model?**
Keep the same output contract: the model proposes JSON steps, and `clean_definition` validates them before anything is shown or saved. I would start with a small local model, because the data may be sensitive. The safety check stays the same.

**What happens if a step fails?**
The step is retried if retries are set. If it still fails, the run is marked failed with the step name and message, later steps do not run, and the failure shows up in the history, the dashboard and the failure summary.

**How do schedules work, and what are the limits?**
A thread in the backend checks the schedules table every 20 seconds and queues what is due. Times are stored in UTC and shown on the user's clock. Limits: it only runs while the backend is running, and there is one process, so it is not built for several servers.

**Why SQLite? Would it scale?**
It is free, needs no setup, and is fine for one user. For more users I would move to PostgreSQL, add Alembic migrations (not built yet), and replace the in-memory queue with a real job system such as Celery or RQ with Redis.

**What was the hardest bug?**
Pick one you really remember. True examples from this project: the first dashboard crashed in tests because charts need a browser feature (`ResizeObserver`) that the test environment lacked; a stale dev server did not know a new CSS class; and the scheduler thread had to be shared safely when the app starts more than once in tests.

**How did you test it?**
Backend: pytest covers the engine, the editor's checks, analytics, assistant, schedules, data sources, login and queue. Frontend: Vitest with Testing Library for the pages. I also started the real server and used it. I have not run automated browser tests, and I have not load tested it.

**What would you build next?**
Email or Slack notifications (today a notify step only writes to the log), Alembic migrations, PostgreSQL, a real job queue, roles and several users, and a proper deployment with HTTPS.

**How does this connect to the jobs you want?**
Junior data/business analyst roles: it shows I can clean and validate data, think in KPIs, and explain results. Automation roles: it shows I understand workflows, error handling, scheduling and logging.

## Limits you should say before they ask

- One owner account, no roles, no password reset by email. Use HTTPS before putting it online.
- Notify steps only write to the log. Nothing is emailed.
- CSV files only. No databases, spreadsheets or APIs as sources yet.
- The queue and scheduler live in the backend process.
- No database migration tool yet.
- The assistant is rules-based, not a language model.

Saying these first sounds confident, not weak.

## A 5-minute demo script

1. **Overview** (15 s): "Every number comes from stored runs." Empty before the first run.
2. **Reconciliations** (60 s): run COD Reconciliation, choose courier_collections.csv and bank_deposits.csv.
3. **Run page** (90 s): 55 matched, 7 exceptions, filter by type, read the reasons, reject one with a note, approve the rest, then open the Audit trail and say the app cannot edit or delete entries.
4. **Assistant** (45 s): type "Reconcile courier collections with bank deposits and alert finance if anything does not match", show the reasons, save and run.
5. **Builder** (30 s): show the Compare step settings (matching columns, allowed difference).
6. **Schedules** (30 s): add a daily schedule, explain the limit.
7. **Close** (30 s): the limits list above, then "next I would add email notifications and PostgreSQL."

## Before the interview

- Start the backend and the frontend 10 minutes early and click through the demo once.
- Know one bug story and one design decision in your own words.
- If you cannot answer something, say: "I did not build that part. Here is how I would find out."
