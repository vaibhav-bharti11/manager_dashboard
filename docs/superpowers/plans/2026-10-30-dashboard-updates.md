# Dashboard updates implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Work stays local until validated; GitHub publication is explicitly authorized by the user.

**Goal:** Apply the eight changes in the supplied Oct 30 service software brief without inventing its unresolved business rules.

**Architecture:** Keep React/Vite and Supabase, server-enforced authorization and immutable report/ledger history. Date-range summaries use business dates and Asia/Kolkata today. Changes to scoring, authentication and people management require the user's pending clarifications before implementation or publication.

**Tech Stack:** React 19, Vite 6, Supabase/PostgreSQL, Node tests and PGlite.

**Spec:** C:/Users/ASUS/Downloads/service_software_changes_brief-4df80142.txt (DOCX checked: same eight items).

## Global constraints
- Preserve at least six months of report and point history; never delete history during resets or removal.
- Reports are required every day once their schedule is configured; remove weekday/closed-date exceptions prospectively.
- Keep PIN values and credentials out of code, logs and GitHub.
- Scope all reads and writes to the authenticated role and restaurant.
- Do not guess reset anchor, negative-point rules, alert audience/channel, PIN lifecycle or removal semantics.
- Latest user instruction authorizes GitHub upload and Netlify automatic deployment after checks.

## Resolved with the user
- The admin manually starts the first cycle. A manual reset restarts its interval and sets points to zero.
- Scores cannot be negative. Each form's missed-report deduction is configurable.
- Admins receive below-benchmark alerts inside the dashboard. Only the affected manager receives the advance warning, when another missed-form deduction could cross the benchmark.
- The owner chooses their initial four-digit PIN using an admin-issued one-time activation code. PIN changes require their signed-in dashboard.
- Removal deactivates access and keeps history. Self-deactivation and removing the last active admin are blocked.

## Verification completed
- 83 automated checks and the production build pass.
- Database migrations 003–008 and all three functions were deployed and checked.
- Nine live authentication/authorization checks passed; actual manager phone login and date-range controls were checked in the built-in browser.
- The frontend commit is published on Netlify; its production JavaScript and CSS hashes match the tested local build. Backend source, tests and documentation are being synced to the same GitHub repository.

## Review focus
- IST midnight, invalid/reversed ranges and month-end six-month limits: date helper tests.
- More than 1,000 retained records: pagination tests so summaries cannot silently truncate.
- Multiple managers at one restaurant, duplicate rows and resets: summaries group by manager ID and immutable business-date ledger.
- Existing policies and prior obligations: migration tests must preserve historical deadlines and awards.
- Failed/unauthorized PIN, reset and removal actions: server-side tests after clarification.

### Task 1: Date-range reporting (independent of unresolved rules)
- [ ] Write failing date, count, manager-summary and pagination tests.
- [ ] Implement `src/reportingRange.mjs` and `src/pagination.mjs`; integrate paginated reads in `src/api.mjs`.
- [ ] Default overview to today; add single-date/range controls shared with report register/performance and filter all historical views consistently.
- [ ] Show submitted, awaited, missed and per-manager submitted/earned/missed summaries; keep all report/history rows intact.
- [ ] Verify regression tests and build; inspect in built-in browser.

### Task 2: Daily schedules and scoring updates
- [ ] Resolve reset anchor, reset score and negative-point meaning with user.
- [ ] Write migration tests for daily scheduling, interval boundaries, idempotent resets and preserved history.
- [ ] Add validated migration/RPCs and admin controls; remove weekly/floor/weekday UI.
- [ ] Implement benchmark configuration and alerts only after recipient/channel clarification.

### Task 3: Phone/PIN and people removal
- [ ] Resolve PIN creation/recovery and removal scope/semantics with user.
- [ ] Write authorization, lockout, input validation and history-preservation tests.
- [ ] Implement server-side account actions and UI using agreed rules; never ship a client-side PIN check.

### Task 4: Release
- [ ] Run full tests/build, review diff and verify browser flows.
- [ ] Apply required Supabase migrations/function updates before releasing their clients.
- [ ] Upload exact reviewed changes to vaibhav-bharti11/manager_dashboard, verify Netlify publication and production assets.
- [ ] Report completed changes and any explicit unresolved items candidly.
