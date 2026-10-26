# AutoFlow Studio: honest review and roadmap

> **Update, October 2026.** Phases 1 and 2 are done: Excel, several tables, files chosen at run time, the Compare step with exceptions and reasons, the COD template and the assistant. The project was then refocused on reconciliation: the Upload CSV page, the Analytics page, the form editor, the unrelated demo workflows and templates, and the made-up demo history were removed. The review below describes the project before that and is kept for the reasoning.

No code was changed for this document. It is based on reading the actual code, not the buttons.

## 1. What really works today, and what does not

**Real and tested**
- A workflow engine with 8 step types, branching on numbers, retries, a 50-step loop guard, and a full step-by-step log.
- Data checks: missing values, duplicate rows, text where numbers should be, required columns.
- Cleaning: trim text, drop duplicates, drop missing rows, drop non-numeric rows.
- Scheduling (every N minutes, daily, weekly), a background run queue, login, Data Sources (list, preview, delete), analytics from real runs, a flow-diagram view, a builder and a form editor.

**Real, but weaker than it looks**
- **The "report" step** only writes `describe()` statistics (count, mean, min, max) and the cleaned file. That is not a business report.
- **The "notify" step** writes a line in the log. Nothing is sent.
- **Trigger kinds** (manual, upload, schedule) are labels. A schedule works because of the Schedules table, not because of the trigger step.
- **The assistant** is keyword rules. It is honest about that, but it can only build the same few shapes.

**Does not exist at all**
- Anything that uses **two files at once**. The engine holds one table in memory. So it cannot compare, match or reconcile.
- **Choosing files when you run a saved workflow.** Saved workflows are hard-wired to one sample file. Only the Upload page runs on your own file, and with a fixed pipeline.
- **Excel files (.xlsx).** Finance teams live in Excel. Only CSV works.
- **Human approval** before something is finalized.
- **Watching a folder** for new files.
- **Real reports** (summary by category, charts, an Excel file people can send on).
- **An audit trail** beyond the run log (who approved what, when, and why).

## 2. Challenging the current idea

**The product today is a general workflow builder with data-quality checks.** That space is full (Zapier, Make, n8n, Power Automate), and all of them are better at generality. A solo project will not win there. "Find blank cells" is also something Excel and Power BI already do in two clicks. A hiring manager will see that.

**What you have that others do not is domain knowledge.** You do COD reconciliation every day. Reconciliation (does list A agree with list B, and who looks at the differences?) is a real, repeated, expensive job in finance, logistics and e-commerce. It is also hard to fake in an interview, which is exactly why it will stand out.

**Where I disagree with parts of your list**
- "Plain-English reports" and "AI categorization" sound impressive but are worth little if the underlying numbers are not right. Get the matching and the exceptions right first. Add language features last, and keep them honest (rules first, an optional local model later).
- "Monitor incoming files" is useful, but on a local app it is a nice extra, not a core feature.
- More step types for Slack, WhatsApp, Google Sheets and so on look good on a list but each needs accounts and secrets. They add risk and no depth.
- Do not add roles, teams, or real-time collaboration. They cost a lot and say nothing about automation skill.

## 3. Recommended product direction

> **AutoFlow Studio: reconciliation and exception-review automation for finance and operations teams.**
> Upload two sources (for example courier collections and bank deposits). The workflow matches them, flags what does not agree, and puts the exceptions in front of a person to approve or reject, with a full audit trail. Everything runs locally, and nothing is a black box.

The workflow builder stays. It becomes the engine that makes this repeatable, instead of the headline.

**What makes it stand out from a basic automation tool**
1. **Reconciliation is built in**, not a script you write.
2. **A human stays in the loop.** Risky items wait for approval.
3. **Every decision is explainable and logged.** "Matched because invoice ID and amount agree within 0.01." "Approved by shahwaiz on 26 Oct, note: ..."
4. **Free and private.** No paid AI, no data leaving the computer.

## 4. Feature ranking

Value = how much a company would care. Difficulty is for the build, not for you.

| # | Feature | Problem it solves | Who uses it | Value | Difficulty | Free tools? |
|---|---|---|---|---|---|---|
| 1 | **Run a workflow on files you choose** (inputs when you click Run) | Today a saved workflow cannot be used on real files | everyone | Very high | Easy-Medium | Yes |
| 2 | **Excel (.xlsx) support**, plus tidy-up of messy columns (amounts like "1,234.50 SAR", dates, spaces) | Real finance data arrives as Excel and is messy | finance, ops | Very high | Easy | Yes (pandas, openpyxl) |
| 3 | **Two-source reconciliation**: match on a key, compare amounts with a tolerance, report matched, missing on each side, amount differences, duplicates | The daily job of comparing two lists by hand | finance, logistics, e-commerce | Highest | Medium | Yes (pandas) |
| 4 | **Exceptions list with reasons** | Reviewers need only the problems, with the reason for each | finance reviewers | High | Easy once #3 exists | Yes |
| 5 | **Approval step + audit trail**: a run pauses, a person approves or rejects each exception or the whole batch, and every decision is stored with who, when and a note | Companies need sign-off and proof of it | finance managers, auditors | High, and it is the standout feature | Hard (pause and resume a run) | Yes |
| 6 | **Anomaly flags**: unusually large amounts, duplicates, amounts just under an approval limit, weekend postings, round numbers | Finds what a person would miss in 10,000 rows | finance, audit | High | Easy-Medium (simple statistics, no AI needed) | Yes |
| 7 | **Real reports**: summary by category or vendor, totals, an Excel file with formatted sheets (summary, exceptions), charts on screen | The output people actually send to a manager | managers | High | Medium | Yes (openpyxl, Recharts) |
| 8 | **Rule-based expense categorization** with an editable rules table | Saves manual tagging | finance | Medium-High | Easy | Yes |
| 9 | **In-app notifications inbox** first, then optional email (SMTP) | "Nothing is sent" is a limitation today | everyone | Medium | Easy (inbox) / Medium (email) | Yes |
| 10 | **Watch an inbox folder**: new file appears, run the workflow | Removes the "remember to upload" step | ops | Medium | Easy (reuses the scheduler) | Yes |
| 11 | **Assistant extended** to reconciliation ("compare bank.csv with ledger.csv and flag differences over 50") | Faster setup | beginners | Medium | Easy once #3 exists | Yes (rules); optional local model later |
| 12 | Reliability: migrations (Alembic), PostgreSQL option, Docker, backups | Needed before real use | engineers | Medium for jobs, low for demo | Medium | Yes |

**Do not build:** more integrations that need accounts, user roles, real-time collaboration, a paid AI API, another dashboard redesign.

## 5. Roadmap

Ordered by what unlocks the next thing.

### Phase 1: Make the foundation usable on real data (builds on what exists)
- Workflows get **inputs**: when you click Run, you pick the files (from Data Sources or an upload).
- The engine can hold **several named tables** at once (for example "bank" and "ledger").
- **Excel files** and messy-column clean-up (amounts, dates, spaces, upper/lower case).
- Fix the weak parts honestly: a real **report** (not `describe()`), and clearer trigger labels.
- *Why first:* nothing else is possible until a workflow can use two real files.

### Phase 2: The most valuable real automation (done)
- A **Compare** step: match on a key, tolerance for amounts, outputs matched, missing in A, missing in B, mismatched amounts, duplicates.
- **Exceptions list** with a plain reason for every row.
- Fictional but realistic sample data: courier collections vs bank deposits, invoices vs payments.
- A **Reconciliation** template.
- *Why:* this is the feature that makes the project about you and your job.

### Phase 3: Review, approval and audit (review page and audit trail done; a pausing Approval step is not)
- A **Review** page for exceptions: approve, reject, add a note.
- An **Approval** step: the run waits, then continues or stops.
- An **audit trail** table that cannot be edited from the app.
- *Why:* it is the difference between a script and a business process.

### Phase 4: Insight and AI-assisted creation
- **Anomaly flags** and **rule-based categorization**.
- **Real reports**: on-screen charts and a formatted Excel file.
- Assistant understands reconciliation requests.
- Optional later: a small local model (for example through Ollama) that only *explains* exceptions in plain words. It never decides. It is off by default.

### Phase 5: Reliability and security
- Watch an inbox folder. In-app inbox, then optional email.
- Alembic migrations, PostgreSQL option, Docker, backups.
- Security pass: upload scanning limits, rate limits, HTTPS setup guide, secrets handling.

Already done from your original idea: scheduling, execution logs, reusable templates, login, a background queue.

## 6. Rules I will keep

- Nothing is called "automated" until it runs and has a test.
- Fictional data only. Nothing leaves your computer.
- Existing code is extended, not thrown away. Existing workflows keep working.
- Anything destructive (deleting data, changing tables) is explained first and backed up.
- Every phase ends with tests, a README that says exactly what works and what does not, and a short demo.

## 7. What I need from you

One decision: **should Phase 1 and Phase 2 become the next work, with reconciliation as the main story?** If yes, I start with Phase 1 (choose files at run time, several tables, Excel).
