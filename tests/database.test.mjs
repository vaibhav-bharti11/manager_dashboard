import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("PostgreSQL migration and server-enforced reporting workflow", async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
  await db.exec(
    await readFile("supabase/migrations/001_restaurant_monitor.sql", "utf8"),
  );
  await db.exec(await readFile("supabase/seed_templates.sql", "utf8"));
  const ids = {
    a: "11111111-1111-4111-8111-111111111111",
    b: "22222222-2222-4222-8222-222222222222",
    admin: "33333333-3333-4333-8333-333333333333",
  };
  for (const id of Object.values(ids))
    await db.query("insert into auth.users values($1)", [id]);
  await db.query(
    `insert into profiles values($1,'Demo One','manager','embassy-vasant'),($2,'Demo Two','manager','kampai'),($3,'Demo Admin','admin',null)`,
    Object.values(ids),
  );
  const asUser = async (id, fn) => {
    await db.exec("set role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };
  await db.exec(await readFile('supabase/migrations/002_employee_management.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/003_evidence_and_live_updates.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/004_atomic_highlights.sql','utf8'));
  await t.test(
    "all eight opening/closing templates retain exact row counts",
    async () => {
      const { rows } = await db.query(
        `select type,jsonb_array_length(rows) as count from report_templates`,
      );
      assert.equal(rows.length, 8);
      assert.ok(
        rows.every((r) => r.count === (r.type === "opening" ? 20 : 22)),
      );
    },
  );
  await t.test(
    "no configured policy creates no occurrences or penalties",
    async () => {
      await db.exec("select reconcile_reports()");
      assert.equal(
        (await db.query("select * from score_ledger")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from occurrences")).rows.length,
        0,
      );
    },
  );
  await t.test(
    "RLS scopes restaurant, templates and users; manager writes blocked",
    async () =>
      asUser(ids.a, async () => {
        assert.equal(
          (await db.query("select * from restaurants")).rows.length,
          1,
        );
        assert.equal(
          (await db.query(`select * from restaurants where id='kampai'`)).rows
            .length,
          0,
        );
        assert.equal((await db.query("select * from profiles")).rows.length, 1);
        await assert.rejects(
          db.query(
            `insert into policies(restaurant_id,type,version) values('embassy-vasant','opening',1)`,
          ),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select reconcile_reports()"),
          /permission denied/,
        );
      }),
  );
  await t.test("non-admin cannot edit timing policy", async () =>
    asUser(ids.a, () =>
      assert.rejects(
        db.query(`select configure_policy($1)`, [
          { restaurant_id: "embassy-vasant", type: "opening" },
        ]),
        /Administrator access required/,
      ),
    ),
  );
  await t.test(
    "admin cannot activate policy without approved choices",
    async () =>
      asUser(ids.admin, () =>
        assert.rejects(
          db.query(`select configure_policy($1)`, [
            {
              restaurant_id: "embassy-vasant",
              type: "opening",
              enabled: true,
              timezone: "Asia/Kolkata",
              effective_from: "2099-01-01",
            },
          ]),
          /approval/,
        ),
      ),
  );
  const snapshot = {
    timezone: "Asia/Kolkata",
    reset_time: "00:00",
    baseline: 100,
    reward: 10,
  };
  const p = (
    await db.query(
      `insert into policies(restaurant_id,type,version,enabled) values('embassy-vasant','opening',1,false) returning id`,
    )
  ).rows[0].id;
  const occurrence = async (
    type = "opening",
    open = -600,
    close = 600,
    restaurant = "embassy-vasant",
    manager = ids.a,
    date = "2026-10-27",
  ) =>
    (
      await db.query(
        `insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values($1,$2,$3,'Morning',$4,$5,$6,clock_timestamp()+$7*interval '1 second',clock_timestamp()+$8*interval '1 second') returning id`,
        [restaurant, type, date, manager, p, snapshot, open, close],
      )
    ).rows[0].id;
  const o = await occurrence();
  const reportData = {
    manager_ack: true,
    completed_by: "Demo Staff",
    completed_time: "10:00",
    verified_time: "10:10",
    responses: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        i,
        { status: "D", initials: "DS" },
      ]),
    ),
  };
  await t.test(
    "tampered occurrence ID cannot cross restaurant scope",
    async () =>
      asUser(ids.b, () =>
        assert.rejects(
          db.query("select submit_report($1,$2)", [o, reportData]),
          /Report unavailable/,
        ),
      ),
  );
  await t.test(
    "incomplete checklists cannot be submitted server-side",
    async () =>
      asUser(ids.a, () =>
        assert.rejects(
          db.query("select submit_report($1,$2)", [
            o,
            { ...reportData, responses: {} },
          ]),
          /Every checklist row/,
        ),
      ),
  );
  await t.test("forged staff or management signature is rejected", async () =>
    asUser(ids.a, () =>
      assert.rejects(
        db.query("select submit_report($1,$2)", [
          o,
          { ...reportData, management_review: "fake" },
        ]),
        /separate authorised actors/,
      ),
    ),
  );
  await t.test(
    "draft does not score, on-time submit rewards once and retry is idempotent",
    async () =>
      asUser(ids.a, async () => {
        await db.query("select save_draft($1,$2)", [o, reportData]);
        assert.equal(
          (await db.query("select * from score_ledger")).rows.length,
          0,
        );
        await db.query("select submit_report($1,$2)", [o, reportData]);
        await db.query("select submit_report($1,$2)", [o, reportData]);
        assert.equal((await db.query("select * from reports")).rows.length, 1);
        assert.equal(
          (await db.query("select * from score_ledger")).rows[0].amount,
          10,
        );
        await assert.rejects(
          db.query(`update reports set manager_name='forged'`),
          /permission denied/,
        );
      }),
  );
  const missed = [];
  for (const [i, type] of ["closing", "incident", "briefing"].entries())
    missed.push(await occurrence(type, -1200, -600));
  const unopened = await occurrence(
    "opening",
    600,
    1200,
    "kampai",
    ids.b,
    "2026-10-28",
  );
  await t.test(
    "stale form and backdated payload fail after deadline",
    async () =>
      asUser(ids.a, () =>
        assert.rejects(
          db.query("select submit_report($1,$2)", [
            missed[0],
            { ...reportData, submitted_at: "2000-01-01" },
          ]),
          /Submission window is closed/,
        ),
      ),
  );
  await t.test("future window cannot submit", async () =>
    asUser(ids.b, () =>
      assert.rejects(
        db.query("select submit_report($1,$2)", [unopened, reportData]),
        /Submission window is closed/,
      ),
    ),
  );
  await t.test(
    "reconciliation penalizes three misses once, never the valid submission or future window",
    async () => {
      await db.exec("select reconcile_reports();select reconcile_reports()");
      const { rows } = await db.query("select * from score_ledger");
      assert.equal(rows.length, 4);
      assert.equal(
        rows
          .filter((x) => x.reason === "missed")
          .reduce((n, x) => n + x.amount, 0),
        -60,
      );
      assert.ok(!rows.some((x) => x.occurrence_id === unopened));
    },
  );
  await t.test(
    "another restaurant cannot read report, draft, highlights or ledger",
    async () =>
      asUser(ids.b, async () => {
        for (const table of ["reports", "drafts", "highlights", "score_ledger"])
          assert.equal(
            (await db.query(`select * from ${table}`)).rows.length,
            0,
          );
      }),
  );
  await t.test(
    "admin can inspect all report logs but cannot submit as manager",
    async () =>
      asUser(ids.admin, async () => {
        assert.equal((await db.query("select * from reports")).rows.length, 1);
        assert.equal(
          (await db.query("select * from audit_log")).rows.length,
          1,
        );
        await assert.rejects(
          db.query("select submit_report($1,$2)", [unopened, reportData]),
          /restaurant manager session/,
        );
      }),
  );
  await t.test(
    "separate incident records are retained within one timed declaration",
    async () => {
      const id = await occurrence(
        "incident",
        -600,
        600,
        "embassy-vasant",
        ids.a,
        "2026-10-29",
      );
      const incident = {
        incident_time: "19:00",
        incident_type: "Equipment / property damage",
        area: "Test area",
        reported_by: "Demo Staff",
        manager_on_duty: "Demo One",
        narrative0: "Fictitious broken chair",
        narrative1: "Removed from floor",
        answer0: "No",
        answer1: "Yes",
      };
      await asUser(ids.a, () =>
        db.query("select submit_report($1,$2)", [
          id,
          {
            ...incident,
            manager_ack: true,
            incidents: [
              { ...incident, narrative0: "Second fictitious incident" },
            ],
          },
        ]),
      );
      assert.equal(
        (await db.query("select * from incident_records")).rows.length,
        2,
      );
    },
  );
  await t.test(
    "approved future policy is versioned, audited and never rewrites existing occurrences",
    async () => {
      const policy = {
        restaurant_id: "embassy-vasant",
        type: "opening",
        enabled: true,
        start_time: "09:00",
        end_time: "12:00",
        timezone: "Asia/Kolkata",
        manager_id: ids.a,
        reward: 10,
        baseline: 100,
        reset_time: "12:00",
        effective_from: "2099-01-01",
        operating_days: [0, 1, 2, 3, 4, 5, 6],
        closed_dates: [],
        approvals: Object.fromEntries(
          [
            "calendar",
            "points",
            "reset",
            "responsibility",
            "incident",
            "handover",
            "director",
            "retention",
          ].map((k) => [k, true]),
        ),
      };
      const before = (
        await db.query("select deadline from occurrences where id=$1", [o])
      ).rows[0].deadline;
      await asUser(ids.admin, () =>
        db.query("select configure_policy($1)", [policy]),
      );
      const versions = (
        await db.query(
          `select * from policies where restaurant_id='embassy-vasant' and type='opening' order by version`,
        )
      ).rows;
      assert.equal(versions.length, 2);
      assert.equal(versions[0].current, false);
      assert.equal(versions[1].current, true);
      assert.equal(
        +(await db.query("select deadline from occurrences where id=$1", [o]))
          .rows[0].deadline,
        +before,
      );
      assert.equal(
        (
          await db.query(
            `select * from audit_log where action='configure_policy'`,
          )
        ).rows.length,
        1,
      );
    },
  );
  await t.test(
    "scheduler recovers past required days after downtime and retries remain safe",
    async () => {
      await db.exec(
        `update policies set effective_from=(now() at time zone 'Asia/Kolkata')::date-3 where current and enabled;select reconcile_reports()`,
      );
      const first = (
        await db.query("select count(*)::int as n from occurrences")
      ).rows[0].n;
      const ledgerCount = (
        await db.query("select count(*)::int as n from score_ledger")
      ).rows[0].n;
      await db.exec("select reconcile_reports()");
      assert.equal(
        (await db.query("select count(*)::int as n from occurrences")).rows[0]
          .n,
        first,
      );
      assert.equal(
        (await db.query("select count(*)::int as n from score_ledger")).rows[0]
          .n,
        ledgerCount,
      );
      assert.ok(first > 5);
    },
  );
  await t.test('employee registration cannot be called directly by a manager',async()=>asUser(ids.a,()=>assert.rejects(db.query('select register_employee($1,$2,$3,$4,$5)',[ids.a,'Fake','fake@example.invalid','kampai',ids.admin]),/permission denied/)));
  await t.test('server registration always creates a scoped manager and an audit record',async()=>{
   const employee='44444444-4444-4444-8444-444444444444';
   await db.query('insert into auth.users values($1)',[employee]);
   await db.exec('set role service_role');
   try{await db.query('select register_employee($1,$2,$3,$4,$5)',[employee,'Demo Employee','employee@example.invalid','kampai',ids.admin]);}finally{await db.exec('reset role')}
   const created=(await db.query('select * from profiles where id=$1',[employee])).rows[0];assert.equal(created.role,'manager');assert.equal(created.restaurant_id,'kampai');assert.equal(created.email,'employee@example.invalid');
   assert.equal((await db.query("select * from audit_log where action='create_employee'")).rows.length,1);
  });
  await db.close();
});
