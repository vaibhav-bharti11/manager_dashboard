# Employee provisioning

User request: create the first admin login now and add an admin option to create employees later.

Implement an admin-only Employees screen. Every employee is an individual authenticated manager assigned to one of the four restaurants. Supabase Edge Function verifies the caller with Auth, verifies its administrator profile, validates the input, creates the Auth user with no invitation/email, and writes the manager profile and audit record. Passwords never appear in profile rows or logs. No client service key and no manager privilege escalation.

Create the first admin using the existing server API key through a one-time local provisioning script. The key remains outside source/build files and is removed immediately after use. The generated login is saved in an ignored local file for the owner. Deploy the employee function, test manager denial and valid account creation with reversible isolated test records as needed, and verify real admin sign-in. Existing schedules remain inactive.
