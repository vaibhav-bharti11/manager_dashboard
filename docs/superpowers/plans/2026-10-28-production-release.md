# Production release and full-flow verification

User request: eliminate all demo data/modes, provide a real administrator login, test manager forms and admin scoring/upload visibility thoroughly, create a GitHub repository and deploy.

1. Remove every production demo fixture, fake clock, bypass login and in-memory submission path. Keep only isolated test fixtures in tests. Preserve the glass UI.
2. Implement private evidence upload/download with server-side identity, restaurant, manager-assignment, deadline, byte-size, MIME/signature and metadata validation. Submitted evidence is available to authorised admin report readers.
3. Add live admin refresh on submissions/points, individual score verification, account password change, reliable drafts, and source-report rendering. Fix observed issues; do not activate business policies without owner choices.
4. Run local SQL/validation/regression checks and a live test matrix with temporary, clearly labelled QA accounts and snapshotted QA occurrences. Exercise every form, submission, draft, lock, highlight, file and admin points path. Record pass/fail, expected and observed scores, evidence hash, negative security cases and limits. Remove QA records/accounts/files before handoff.
5. Reuse the real administrator, generate fresh owner credentials securely, and exclude all credentials/config/runtime fixtures from version control.
6. Create a private GitHub repository, upload the verified source, build and deploy the matching version with Sites. Verify deployed login and basic navigation in the built-in browser. Give repo, live URL, credentials location and test report.

Approval/authority: the latest user request authorises GitHub creation, deployment, real-flow testing, uploads and removing demo/test artifacts. The user's built-in-browser preference remains active. Test policies are temporary and are removed; no final restaurant hours or incentive values are inferred.
