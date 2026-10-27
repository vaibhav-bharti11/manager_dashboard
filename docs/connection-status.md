# Connected Supabase project

Verified on 28 October 2026 through the user's signed-in built-in browser.

- Project: restaurant-monitoring (`lizlrsajwjycdnzwouds`), Mumbai, Free.
- Database: 4 restaurants, 8 outlet templates, 12 RLS-protected tables.
- Anonymous reads denied; manager/admin scope functions installed.
- One active minute reconciliation job; no live policies or penalties enabled.
- Employee-management migration installed and `employee-admin` Edge Function deployed.
- Initial administrator created at the user's request. Real sign-in and profile routing verified.
- Employee endpoint verifies admin JWT/profile and returns HTTP 400 for invalid employee input, as expected. No employee accounts were added just for testing.
- Desktop and phone Employees screens inspected: no page overflow at 1440px and 390px.
- Build succeeds; 33 automated checks pass.

Initial admin credentials are in the ignored `ADMIN_LOGIN.local.txt`, not this document or the browser bundle. The one-time server provisioning key file was removed, and the clipboard was cleared. The browser app uses only the public publishable key from ignored `.env.local`.

Remaining setup is owned by the admin: add real employees, then configure and approve their report windows, reward/baseline and weekly rules in Settings. Private evidence uploads and independent staff/reviewer signatures remain unconfigured as described in README.
