# Service software update

Implements the supplied October 30 brief and the user's clarifications.

- Admin saves a reset interval, starts the points cycle manually, and can reset it again at any time. Every cycle starts at zero; existing reports and ledger history remain.
- Missed-report deductions are configurable per form and capped at the person's available points. There is no weekly baseline, Sunday reset or editable score floor.
- Active schedules require reports every day. Existing occurrence deadlines and snapshots remain unchanged.
- A restaurant benchmark alerts admins to managers below it. Only the affected manager receives their own advance warning when a missed-form deduction could take them below it. Delivery is inside the dashboard.
- Dashboard, reports and performance share date filters, initially today in India time. Manager summaries show submitted, awaited, missed, earned points and net changes. Queries cover the last six months and paginate beyond the first 1,000 rows. Records are not purged by resets or deactivation.
- Managers and new accounts sign in using a phone number and a four-digit PIN. An admin gives the owner a one-time activation code; the owner chooses the PIN. Codes expire after 24 hours. PIN changes require a signed-in session and the current PIN. Admins cannot view or reset another person's PIN.
- Account removal deactivates access, disables assigned future schedules and keeps history. Admins cannot deactivate themselves or leave the system without an active administrator. Restoring access requires checking and reactivating reporting schedules.
- Existing admin email sign-in remains available during phone onboarding.

## Verification

84 automated checks passed, including PostgreSQL migration/RLS tests and all four report types under the new scoring model. The production build passed. Live API checks verified activation, PIN login/change, one-use codes, role isolation, deactivation with an existing session, and restoration. The actual manager workspace and date-range controls were also checked in the built-in browser.

Supabase migrations 003–008 and the employee-admin, phone-auth and report-evidence services were deployed before the frontend. Migration 009 adds an inactive-assignment safeguard across older schedule versions. The existing reconciliation cron runs every minute; form-submission alerts also update in the scoring transaction. `phone-auth` is a public sign-in endpoint with PIN checks and persistent attempt limits; signed-in PIN changes validate the user's JWT and current PIN.

No real PINs, activation codes, backend keys, test sessions or local private files belong in the repository. Deployment reads the public Supabase URL and publishable key from Netlify environment variables.
