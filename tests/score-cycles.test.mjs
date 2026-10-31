import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('manual zero-based cycles, configurable deductions and daily schedules',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const file of ['001_restaurant_monitor.sql','002_employee_management.sql','003_evidence_and_live_updates.sql','004_atomic_highlights.sql','005_score_cycles_and_daily_reports.sql','006_benchmark_alerts.sql','007_phone_pin_and_deactivation.sql','008_cycle_reconciliation.sql'])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 await db.exec(await readFile('supabase/seed_templates.sql','utf8'));
 const admin='11111111-1111-4111-8111-111111111111',manager='22222222-2222-4222-8222-222222222222';
 await db.query('insert into auth.users values($1),($2)',[admin,manager]);
 await db.query("insert into profiles(id,name,role,restaurant_id) values($1,'Admin','admin',null),($2,'Manager','manager','kampai')",[admin,manager]);
 const asUser=async(id,fn)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await db.exec('reset role')}};
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 await t.test('managers cannot configure or reset scores; resets require manual start',async()=>{
  await assert.rejects(()=>asUser(manager,()=>db.query("select configure_scoring('kampai',15,50)")),/Administrator/);
  await assert.rejects(()=>asUser(manager,()=>db.query("select reset_points('kampai')")),/Administrator/);
  await asUser(admin,()=>db.query("select configure_scoring('kampai',15,50)"));
  assert.equal(await scalar("select count(*)::int from score_cycles"),0);
  assert.equal(await scalar("select points from current_score_totals where manager_id=$1",[manager]),0);
  await asUser(admin,()=>db.query("select reset_points('kampai')"));
  assert.equal(await scalar("select count(*)::int from score_cycles"),1);
  assert.equal(await scalar("select extract(epoch from ends_at-starts_at)/86400 from score_cycles"),'15.0000000000000000');
 });
 let policy;
 await t.test('activated policy needs no weekly/floor/calendar fields and always runs daily',async()=>{
  const input={restaurant_id:'kampai',type:'incident',start_time:'08:00',end_time:'23:00',timezone:'Asia/Kolkata',manager_id:manager,reward:10,missed_penalty:7,enabled:true,effective_from:new Date(Date.now()+86400000*2).toISOString().slice(0,10),incident_rule:'daily_declaration',approvals:Object.fromEntries(['calendar','points','reset','responsibility','incident','handover','director','retention'].map(k=>[k,true]))};
  policy=await asUser(admin,()=>scalar('select configure_policy($1)',[input]));
  const p=(await db.query('select * from policies where id=$1',[policy])).rows[0];
  assert.deepEqual(p.operating_days,[0,1,2,3,4,5,6]);assert.deepEqual(p.closed_dates,[]);assert.equal(p.missed_penalty,7);assert.equal(p.baseline,null);assert.equal(p.reset_time,null);assert.equal(p.score_floor,null);
 });
 let day=1;
 const score=async(reason,reward=10,penalty=7)=>{
  const row=(await db.query(`insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values('kampai','incident',$1,'Evening',$2,$3,$4,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour') returning *`,[new Date(Date.UTC(2040,0,day++)).toISOString().slice(0,10),manager,policy,{reward,missed_penalty:penalty}])).rows[0];
  await db.query('select record_score(o,$2) from occurrences o where id=$1',[row.id,reason]);
  await db.query('select record_score(o,$2) from occurrences o where id=$1',[row.id,reason]);
  return row.id;
 };
 await t.test('deductions use the configured amount, cap at zero and cannot duplicate',async()=>{
  await score('submitted');assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),10);
  await score('missed');assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),3);
  await score('missed');assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),0);
  await score('missed');assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),0);
  assert.deepEqual((await db.query('select amount from score_ledger order by created_at,id')).rows.map(r=>r.amount),[10,-7,-3,0]);
 });
 await t.test('manual reset starts at zero and never erases historical ledger',async()=>{
  await score('submitted',30);const count=await scalar('select count(*)::int from score_ledger');
  await asUser(admin,()=>db.query("select reset_points('kampai')"));
  assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),0);
  assert.equal(await scalar('select count(*)::int from score_ledger'),count);
  assert.equal(await scalar('select count(*)::int from score_cycles'),2);
 });
 await t.test('automatic reset uses the manually anchored interval and scopes reads',async()=>{
  await db.exec("update score_cycles set starts_at=clock_timestamp()-interval '31 days',ends_at=clock_timestamp()-interval '16 days' where id=(select current_cycle_id from score_settings where restaurant_id='kampai')");
  await db.query("select ensure_score_cycle('kampai',clock_timestamp())");
  assert.equal(await scalar('select count(*)::int from score_cycles'),3);
  assert.equal(await scalar("select count(*)::int from score_cycles c join score_settings s on s.current_cycle_id=c.id where c.ends_at>clock_timestamp()"),1);
  assert.equal(await asUser(manager,()=>scalar("select count(*)::int from score_settings where restaurant_id='basque'")),0);
  await assert.rejects(()=>asUser(manager,()=>db.query("select ensure_score_cycle('kampai',clock_timestamp())")),/permission denied/);
 });
 await t.test('admin sees below-benchmark alerts; only the affected manager sees advance warnings',async()=>{
  await asUser(admin,()=>db.query("select configure_scoring('kampai',15,25)"));
  await score('submitted',30);
  assert.equal(await asUser(manager,()=>scalar("select count(*)::int from score_alerts where active and kind='approaching_benchmark'")),1);
  assert.equal(await asUser(admin,()=>scalar("select count(*)::int from score_alerts where active and kind='approaching_benchmark'")),0);
  const other='33333333-3333-4333-8333-333333333333';
  await db.query('insert into auth.users values($1)',[other]);await db.query("insert into profiles(id,name,role,restaurant_id) values($1,'Colleague','manager','kampai')",[other]);
  assert.equal(await asUser(other,()=>scalar('select count(*)::int from score_alerts where active and manager_id=$1',[manager])),0);
  await score('missed');
  assert.equal(await asUser(admin,()=>scalar("select count(*)::int from score_alerts where manager_id=$1 and active and kind='below_benchmark'",[manager])),1);
  assert.equal(await asUser(manager,()=>scalar("select count(*)::int from score_alerts where active and kind='approaching_benchmark'")),0);
  assert.equal(await asUser(other,()=>scalar('select count(*)::int from score_alerts where active and manager_id=$1',[manager])),0);
 });
 await t.test('daily reconciliation includes every weekday and preserves original obligations',async()=>{
  await db.query("update policies set effective_from=(now() at time zone 'Asia/Kolkata')::date-6,daily_required_from=(now() at time zone 'Asia/Kolkata')::date-6,operating_days=array[0],closed_dates=array[(now() at time zone 'Asia/Kolkata')::date] where id=$1",[policy]);
  await db.exec('select reconcile_reports()');
  const dates=(await db.query("select business_date from occurrences where business_date between (now() at time zone 'Asia/Kolkata')::date-6 and (now() at time zone 'Asia/Kolkata')::date+1")).rows;
  assert.equal(dates.length,8);
  const count=await scalar('select count(*)::int from occurrences');await db.exec('select reconcile_reports()');assert.equal(await scalar('select count(*)::int from occurrences'),count);
 });
 await t.test('PIN setup is service-only, single-use, and credentials are unreadable by clients',async()=>{
  await assert.rejects(()=>asUser(manager,()=>db.query('select * from private_pin_credentials')),/permission denied/);
  await assert.rejects(()=>asUser(manager,()=>db.query('select issue_phone_setup($1,$2,$3,$4)',[admin,manager,'+919876543210','a'.repeat(64)])),/permission denied/);
  await db.query('select issue_phone_setup($1,$2,$3,$4)',[admin,manager,'+919876543210','a'.repeat(64)]);
  await assert.rejects(()=>db.query('select consume_phone_setup($1,$2,$3,$4)',[manager,'b'.repeat(64),'c'.repeat(64),'s'.repeat(36)]),/Invalid or expired/);
  await db.query('select consume_phone_setup($1,$2,$3,$4)',[manager,'a'.repeat(64),'c'.repeat(64),'s'.repeat(36)]);
  await assert.rejects(()=>db.query('select consume_phone_setup($1,$2,$3,$4)',[manager,'a'.repeat(64),'c'.repeat(64),'s'.repeat(36)]),/Invalid or expired/);
  await assert.rejects(()=>db.query('select issue_phone_setup($1,$2,$3,$4)',[admin,manager,'+919876543210','a'.repeat(64)]),/only the person/);
  await assert.rejects(()=>db.query('select change_phone_pin($1,$2,$3,$4)',[manager,'wrong','d'.repeat(64),'t'.repeat(36)]),/PIN changed/);
  await db.query('select change_phone_pin($1,$2,$3,$4)',[manager,'c'.repeat(64),'d'.repeat(64),'t'.repeat(36)]);
 });
 await t.test('authentication attempt counters reject repeated guessing atomically',async()=>{
  for(let i=0;i<8;i++)assert.equal(await scalar('select claim_auth_attempt($1,8)',['phone:'+'a'.repeat(64)]),true);
  assert.equal(await scalar('select claim_auth_attempt($1,8)',['phone:'+'a'.repeat(64)]),false);
  await db.exec("update private_auth_attempts set window_start=window_start-interval '15 minutes'");
  assert.equal(await scalar('select claim_auth_attempt($1,8)',['phone:'+'a'.repeat(64)]),true);
 });
 await t.test('deactivation immediately blocks scope and submissions without erasing history',async()=>{
  const count=await scalar('select count(*)::int from score_ledger');
  await assert.rejects(()=>asUser(manager,()=>db.query('select set_account_active($1,false)',[admin])),/Administrator/);
  await assert.rejects(()=>asUser(admin,()=>db.query('select set_account_active($1,false)',[admin])),/own account/);
  await asUser(admin,()=>db.query('select set_account_active($1,false)',[manager]));
  assert.equal(await scalar('select active from profiles where id=$1',[manager]),false);
  assert.equal(await scalar('select count(*)::int from score_ledger'),count);
  assert.equal(await asUser(manager,()=>scalar("select has_scope('kampai')")),false);
  await assert.rejects(()=>asUser(manager,()=>db.query('select submit_report($1,$2)',[crypto.randomUUID(),{}])),/deactivated/);
  assert.equal(await scalar('select count(*)::int from policies where manager_id=$1 and enabled',[manager]),0);
  await asUser(admin,()=>db.query('select set_account_active($1,true)',[manager]));
  assert.equal(await scalar('select count(*)::int from score_ledger'),count);
 });
 await t.test('all four forms submit through the new RPC once, and resets/deactivation keep reports',async()=>{
  await asUser(admin,()=>db.query("select reset_points('kampai')"));
  const checklist=n=>({manager_ack:true,completed_by:'Staff',completed_time:'10:00',verified_time:'10:05',responses:Object.fromEntries(Array.from({length:n},(_,i)=>[i,{status:'D',initials:'ST'}]))});
  const payloads={opening:checklist(20),closing:checklist(22),incident:{manager_ack:true,no_incident:true},briefing:{manager_ack:true,shift:'Lunch',briefing_by:'Manager',start_time:'10:00',ended_time:'10:10',responses:Object.fromEntries(Array.from({length:14},(_,i)=>[i,{done:true}]))}};
  for(const [type,data]of Object.entries(payloads)){
   const id=await scalar(`insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values('kampai',$1,'2041-01-01','Evening',$2,$3,$4,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour') returning id`,[type,manager,policy,{reward:12,missed_penalty:7}]);
   await asUser(manager,()=>db.query('select submit_report($1,$2)',[id,data]));await asUser(manager,()=>db.query('select submit_report($1,$2)',[id,data]));
  }
  assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),48);
  assert.equal(await scalar('select count(*)::int from reports'),4);
  await asUser(admin,()=>db.query("select reset_points('kampai')"));
  assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),0);
  await asUser(admin,()=>db.query('select set_account_active($1,false)',[manager]));
  assert.equal(await scalar('select count(*)::int from reports'),4);
  assert.equal(await scalar("select count(*)::int from score_ledger where business_date='2041-01-01'"),4);
 });
 await t.test('scheduled reconciliation resets expired cycles and alerts admins without a submission',async()=>{
  await asUser(admin,()=>db.query('select set_account_active($1,true)',[manager]));
  await asUser(admin,()=>db.query("select configure_scoring('kampai',15,50)"));
  await score('submitted',100);
  await db.exec("update score_cycles set ends_at=clock_timestamp()-interval '1 second',starts_at=clock_timestamp()-interval '15 days' where id=(select current_cycle_id from score_settings where restaurant_id='kampai')");
  const before=await scalar("select current_cycle_id from score_settings where restaurant_id='kampai'");
  await db.exec('select reconcile_reports()');
  assert.notEqual(await scalar("select current_cycle_id from score_settings where restaurant_id='kampai'"),before);
  assert.equal(await scalar('select points from current_score_totals where manager_id=$1',[manager]),0);
  assert.equal(await asUser(admin,()=>scalar("select count(*)::int from score_alerts where manager_id=$1 and active and kind='below_benchmark'",[manager])),1);
 });
});
