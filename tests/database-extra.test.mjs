import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL evidence, four-form scoring and historical weeks', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
  for (const file of ['001_restaurant_monitor.sql', '002_employee_management.sql', '003_evidence_and_live_updates.sql', '004_atomic_highlights.sql'])
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed_templates.sql', 'utf8'));
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const same = '33333333-3333-4333-8333-333333333333';
  const admin = '44444444-4444-4444-8444-444444444444';
  for (const id of [a,b,same,admin]) await db.query('insert into auth.users values($1)', [id]);
  await db.query(`insert into profiles(id,name,role,restaurant_id) values
    ($1,'Fixture A','manager','embassy-vasant'),($2,'Fixture B','manager','kampai'),
    ($3,'Fixture Colleague','manager','embassy-vasant'),($4,'Fixture Admin','admin',null)`,[a,b,same,admin]);
  const role = async (name, actor, fn) => {
    await db.exec(`set role ${name}`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [actor || '']);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const manager = (actor, fn) => role('authenticated',actor,fn);
  const server = fn => role('service_role',null,fn);
  const policy = (await db.query(`insert into policies(restaurant_id,type,version) values('embassy-vasant','opening',1) returning id`)).rows[0].id;
  const snapshot = { timezone:'Asia/Kolkata',reset_time:'12:00',baseline:100,reward:10 };
  let date = 1;
  const occurrence = async (type='incident', actor=a, opens=-600, deadline=600, extra={}) => {
    const restaurant = actor===b ? 'kampai' : 'embassy-vasant';
    return (await db.query(`insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline)
      values($1,$2,$3,'Morning',$4,$5,$6,clock_timestamp()+$7*interval '1 second',clock_timestamp()+$8*interval '1 second') returning id`,
      [restaurant,type,new Date(Date.UTC(2040,0,date++)).toISOString().slice(0,10),actor,policy,{...snapshot,...extra},opens,deadline])).rows[0].id;
  };
  const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  const evidenceArgs = async (id, actor=a, overrides={}) => {
    const path = `embassy-vasant/${id}/fixture.pdf`;
    await db.query(`insert into storage.objects(bucket_id,name) values('incident-evidence',$1)`,[path]);
    const data = { actor,id,path,name:'fixture.pdf',mime:'application/pdf',size:128,sha:'a'.repeat(64),...overrides };
    return [data.actor,data.id,data.path,data.name,data.mime,data.size,data.sha];
  };
  const register = args => db.query('select register_evidence($1,$2,$3,$4,$5,$6,$7)',args);
  const checklist = n => ({manager_ack:true,completed_by:'Fixture staff',completed_time:'10:00',verified_time:'10:05',
    responses:Object.fromEntries(Array.from({length:n},(_,i)=>[i,{status:'D',initials:'FS'}]))});
  const payloads = {
    opening:checklist(20), closing:checklist(22), incident:{manager_ack:true,no_incident:true},
    briefing:{manager_ack:true,shift:'Lunch',briefing_by:'Fixture A',start_time:'10:00',ended_time:'10:10',
      responses:Object.fromEntries(Array.from({length:14},(_,i)=>[i,{done:true}]))},
  };

  await t.test('private bucket allows only bounded image/PDF objects',async()=>{
    const bucket=(await db.query(`select * from storage.buckets where id='incident-evidence'`)).rows[0];
    assert.equal(bucket.public,false); assert.equal(Number(bucket.file_size_limit),10485760);
    assert.deepEqual(bucket.allowed_mime_types.sort(),['application/pdf','image/jpeg','image/png']);
  });
  const upload = await occurrence();
  const args = await evidenceArgs(upload);
  await t.test('authenticated manager and admin cannot execute server-only upload RPC',async()=>{
    for (const actor of [a,admin]) await manager(actor,()=>assert.rejects(register(args),/permission denied/));
    await role('anon',null,()=>assert.rejects(register(args),/permission denied/));
  });
  await t.test('upload RPC rejects unassigned same-restaurant manager and cross-restaurant actor',async()=>{
    for (const actor of [same,b,admin]) await server(()=>assert.rejects(register([actor,...args.slice(1)]),/Report unavailable/));
    assert.equal(await scalar('select count(*)::int from evidence'),0);
  });
  await t.test('upload RPC requires matching restaurant, occurrence folder and existing private object',async()=>{
    for (const path of [`kampai/${upload}/fixture.pdf`,`embassy-vasant/${admin}/fixture.pdf`,`embassy-vasant/${upload}/absent.pdf`])
      await server(()=>assert.rejects(register([a,upload,path,...args.slice(3)]),/Uploaded object is unavailable/));
    await db.query(`insert into storage.objects(bucket_id,name) values('other-bucket',$1)`,[`embassy-vasant/${upload}/other.pdf`]);
    await server(()=>assert.rejects(register([a,upload,`embassy-vasant/${upload}/other.pdf`,...args.slice(3)]),/Uploaded object is unavailable/));
  });
  await t.test('upload rejects future, expired, disabled and already missed windows',async()=>{
    for (const [opens,deadline,flag] of [[600,1200,null],[-1200,-600,null],[-600,600,'enabled=false'],[-600,600,'missed_at=now()']]) {
      const id=await occurrence('incident',a,opens,deadline);
      if(flag) await db.query(`update occurrences set ${flag} where id=$1`,[id]);
      const values=await evidenceArgs(id);
      await server(()=>assert.rejects(register(values),/Upload window is closed/));
    }
  });
  await t.test('upload metadata enforces MIME, positive 10MB size limit and SHA-256 format atomically',async()=>{
    for (const change of [{mime:'text/html'},{size:0},{size:-1},{size:10485761},{sha:'invalid'},{sha:'A'.repeat(64)}]) {
      const bad=[...args];
      for(const [key,value] of Object.entries(change)) bad[{mime:4,size:5,sha:6}[key]]=value;
      await server(()=>assert.rejects(register(bad),/check constraint/));
    }
    assert.equal(await scalar('select count(*)::int from evidence'),0);
    assert.equal(await scalar(`select count(*)::int from audit_log where action='upload_evidence'`),0);
  });
  await t.test('valid server upload stores metadata, audits once, rejects duplicate path and scopes reads',async()=>{
    await server(()=>register(args));
    await server(()=>assert.rejects(register(args),/unique constraint/));
    assert.equal(await scalar(`select count(*)::int from audit_log where action='upload_evidence'`),1);
    await manager(a,async()=>{
      assert.equal(await scalar('select count(*)::int from evidence'),1);
      await assert.rejects(db.query(`delete from evidence`),/permission denied/);
    });
    await manager(b,async()=>assert.equal(await scalar('select count(*)::int from evidence'),0));
    await manager(admin,async()=>assert.equal(await scalar('select count(*)::int from evidence'),1));
    const metadata=(await db.query('select * from evidence')).rows[0];
    assert.equal(metadata.uploaded_by,a); assert.equal(metadata.occurrence_id,upload); assert.equal(metadata.sha256,args[6]);
  });
  const submitted = {};
  await t.test('each of four complete forms earns exactly +10 despite retry and repeated reconciliation',async()=>{
    for(const [type,payload] of Object.entries(payloads)) {
      const id=await occurrence(type); submitted[type]=id;
      await manager(a,async()=>{
        await db.query('select submit_report($1,$2)',[id,payload]);
        await db.query('select submit_report($1,$2)',[id,payload]);
      });
    }
    await db.exec('select reconcile_reports(); select reconcile_reports();');
    const entries=(await db.query(`select * from score_ledger where occurrence_id=any($1::uuid[])`,[Object.values(submitted)])).rows;
    assert.equal(entries.length,4); assert.ok(entries.every(x=>x.amount===10&&x.reason==='submitted'&&x.manager_id===a));
    assert.equal(entries.reduce((sum,x)=>sum+x.amount,0),40);
  });
  await t.test('submitted report and evidence window stay immutable after retry, draft, update and delete',async()=>{
    const id=submitted.opening;
    const before=(await db.query('select * from reports where occurrence_id=$1',[id])).rows[0];
    await manager(a,async()=>{
      await db.query('select submit_report($1,$2)',[id,{...payloads.opening,completed_by:'Tampered'}]);
      await assert.rejects(db.query('select save_draft($1,$2)',[id,payloads.opening]),/Draft window is closed/);
      await assert.rejects(db.query('update reports set data=$1 where occurrence_id=$2',[{},id]),/permission denied/);
      await assert.rejects(db.query('delete from reports where occurrence_id=$1',[id]),/permission denied/);
    });
    assert.deepEqual((await db.query('select * from reports where occurrence_id=$1',[id])).rows[0],before);
    await server(()=>assert.rejects(register([a,id,`embassy-vasant/${id}/new.pdf`,...args.slice(3)]),/Upload window is closed/));
  });
  await t.test('same-restaurant manager cannot submit another assignment; scores remain per account',async()=>{
    const id=await occurrence('incident',same);
    await manager(a,()=>assert.rejects(db.query('select submit_report($1,$2)',[id,payloads.incident]),/Report unavailable/));
    await manager(same,()=>db.query('select submit_report($1,$2)',[id,payloads.incident]));
    const own=(await db.query('select * from score_ledger where occurrence_id=$1',[id])).rows[0];
    assert.equal(own.manager_id,same); assert.equal(own.amount,10);
    const week=(await db.query('select * from score_weeks where id=$1',[own.week_id])).rows[0];
    assert.equal(week.manager_id,same); assert.equal(week.baseline,100);
    assert.ok(!(await db.query(`select * from score_ledger where manager_id=$1`,[a])).rows.some(x=>x.occurrence_id===id));
  });
  await t.test('each missed form loses 20 once and cannot later become a rewarded report',async()=>{
    const ids=[];
    for(const type of Object.keys(payloads)) ids.push(await occurrence(type,b,-1200,-600));
    await db.exec('select reconcile_reports(); select reconcile_reports();');
    const entries=(await db.query('select * from score_ledger where occurrence_id=any($1::uuid[])',[ids])).rows;
    assert.equal(entries.length,4);assert.ok(entries.every(x=>x.amount===-20&&x.reason==='missed'&&x.manager_id===b));
    assert.equal(entries.reduce((sum,x)=>sum+x.amount,0),-80);
    for(const id of ids) await manager(b,()=>assert.rejects(db.query('select submit_report($1,$2)',[id,payloads.incident]),/Submission window is closed/));
  });
  await t.test('Sunday noon reset assigns exact boundary to new week and preserves prior snapshots/history',async()=>{
    const before=await occurrence('incident',same), boundary=await occurrence('incident',same), later=await occurrence('incident',same);
    for(const [id,time,baseline] of [[before,'2030-01-06T06:29:59Z',77],[boundary,'2030-01-06T06:30:00Z',120],[later,'2030-01-06T07:00:00Z',999]]) {
      await db.query(`update occurrences set opens_at=$2::timestamptz,deadline=$2::timestamptz+interval '1 hour',policy_snapshot=$3 where id=$1`,[id,time,{...snapshot,baseline}]);
      await db.query(`select record_score(o,'submitted') from occurrences o where id=$1`,[id]);
    }
    const entries=(await db.query(`select l.occurrence_id,w.starts_on::text,w.baseline,w.timezone,w.reset_time::text from score_ledger l join score_weeks w on w.id=l.week_id where l.occurrence_id=any($1::uuid[])`,[[before,boundary,later]])).rows;
    assert.equal(entries.find(x=>x.occurrence_id===before).starts_on,'2029-12-30');
    assert.equal(entries.find(x=>x.occurrence_id===before).baseline,77);
    for(const id of [boundary,later]) {
      const entry=entries.find(x=>x.occurrence_id===id);
      assert.equal(entry.starts_on,'2030-01-06');assert.equal(entry.baseline,120);
      assert.equal(entry.timezone,'Asia/Kolkata');assert.equal(entry.reset_time,'12:00:00');
    }
    await db.query(`update policies set baseline=555,reward=55 where id=$1`,[policy]);
    assert.equal(await scalar(`select sum(amount)::int from score_ledger where occurrence_id=any($1::uuid[])`,[[before,boundary,later]]),30);
    assert.equal(await scalar(`select baseline from score_weeks where manager_id=$1 and starts_on='2029-12-30'`,[same]),77);
    await manager(b,async()=>assert.equal(await scalar(`select count(*)::int from score_weeks where manager_id=$1`,[same]),0));
  });
  await t.test('invalid checklist issues, acknowledgment, briefing, incident and oversized payloads do not mutate reports or scores',async()=>{
    const cases=[
      ['opening',{...payloads.opening,manager_ack:false},/Explicit manager/],
      ['closing',checklist(20),/Every checklist row/],
      ['opening',{...payloads.opening,responses:{...payloads.opening.responses,0:{status:'I',initials:'FS'}}},/Issues require/],
      ['opening',{...payloads.opening,padding:'x'.repeat(262144)},/oversized/],
      ['briefing',{...payloads.briefing,responses:{}},/Every briefing/],
      ['briefing',{...payloads.briefing,shift:'Morning'},/Briefing facilitator/],
      ['incident',{manager_ack:true},/Complete incident/],
      ['incident',{manager_ack:true,no_incident:true,staff_signature:'forged'},/separate authorised actors/],
    ];
    for(const [type,payload,error] of cases) {
      const id=await occurrence(type);
      await manager(a,()=>assert.rejects(db.query('select submit_report($1,$2)',[id,payload]),error));
      assert.equal(await scalar('select count(*)::int from reports where occurrence_id=$1',[id]),0);
      assert.equal(await scalar('select count(*)::int from score_ledger where occurrence_id=$1',[id]),0);
    }
  });
  await t.test('opening and closing flags atomically retain source row, note, account and restaurant; retries do not duplicate',async()=>{
    for(const [type,actor] of [['opening',a],['closing',b]]) {
      const id=await occurrence(type,actor);
      const payload={...payloads[type],flags:[0,2,2],highlight_notes:{0:'Fixture director note',2:'   '}};
      await manager(actor,async()=>{
        await db.query('select submit_report($1,$2)',[id,payload]);
        await db.query('select submit_report($1,$2)',[id,payload]);
      });
      const report=(await db.query('select * from reports where occurrence_id=$1',[id])).rows[0];
      const points=(await db.query('select * from highlights where report_id=$1 order by row_number',[report.id])).rows;
      const rows=await scalar('select rows from report_templates where restaurant_id=$1 and type=$2',[report.restaurant_id,type]);
      assert.equal(points.length,2);
      assert.equal(points[0].text,`${rows[0]} — Fixture director note`);
      assert.equal(points[1].text,rows[2]);
      assert.ok(points.every(x=>x.manager_id===actor&&x.restaurant_id===report.restaurant_id&&x.type===type&&x.manager_name===report.manager_name));
      assert.equal(await scalar('select count(*)::int from score_ledger where occurrence_id=$1',[id]),1);
      await manager(actor===a?b:a,async()=>assert.equal(await scalar('select count(*)::int from highlights where report_id=$1',[report.id]),0));
    }
  });
  await t.test('invalid highlight rolls back report, occurrence, score, valid earlier highlight and audit together',async()=>{
    for(const invalid of [20,-1,'invalid']) {
      const id=await occurrence('opening');
      await manager(a,()=>assert.rejects(db.query('select submit_report($1,$2)',[id,{...payloads.opening,flags:[0,invalid]}]),/Invalid director highlight row/));
      for(const table of ['reports','score_ledger'])
        assert.equal(await scalar(`select count(*)::int from ${table} where occurrence_id=$1`,[id]),0);
      assert.equal(await scalar(`select count(*)::int from audit_log where after_value->>'occurrence_id'=$1`,[id]),0);
      assert.equal(await scalar('select submitted_at from occurrences where id=$1',[id]),null);
      await manager(a,()=>db.query('select submit_report($1,$2)',[id,{...payloads.opening,flags:[0]}]));
      assert.equal(await scalar(`select count(*)::int from highlights h join reports r on r.id=h.report_id where r.occurrence_id=$1`,[id]),1);
    }
  });
});
