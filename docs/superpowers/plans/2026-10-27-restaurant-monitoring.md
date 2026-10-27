# Restaurant Monitoring Implementation Plan

Goal: Build the requested warm glass restaurant dashboard, complete source-based forms, and Supabase enforcement.

Architecture: React/Vite UI with an explicitly isolated, fictitious demo. Supabase Auth, RLS and SQL RPCs are authoritative for connected mode. Unconfigured production policies never create misses.

Spec: The supplied text build prompt and four incident/briefing documents, with the user's direct request overriding older uncertainty about the reference image and daily frequency.

1. Extract exact opening/closing appendix rows and briefing/incident fields. Test time boundaries, overnight dates, scoring idempotence, restaurant scope, Sunday boundaries and required form responses.
2. Implement pure policy helpers, complete form schemas, demo fixtures, scoped auth client, and responsive dashboard matching the reference. Demo never claims authentication or persistent server enforcement.
3. Implement Supabase migrations: restaurants, profiles, audited policy versions, snapshotted occurrences, drafts, immutable reports, highlights, weeks, ledger, private storage, submission RPC and scheduler reconciliation. No live policies or real users seeded.
4. Build/test, inspect desktop and mobile in browser, correct observed defects, show local preview. Apply database only when Supabase connection is available.

Confirmed: Four restaurants, four ordered report tabs, one morning/three evening forms, admin windows, lock after deadline, manager points, missed penalty 20, Sunday reset, closing attribution and selected highlights.

TBC: Actual times, award points, initial score/floor, Sunday cutoff/timezone approval, accountable managers/calendar, incident declaration rule, director audience, handover linkage and evidence retention.

Implementation decisions: Demo uses +10 on time, −20 missed, 100 baseline and Asia/Kolkata Sunday midnight, visibly demo-only. Production activation requires explicit settings; no scoring from an unconfigured policy. No automatic negative sentiment detection.
