import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('temporary live-QA helpers prepare and remove only their own isolated fixtures',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;create schema cron;create table cron.job(jobid int,jobname text);create table cron.job_run_details(jobid int,status text,return_message text,start_time timestamptz);`);
 for(const path of ['supabase/migrations/001_restaurant_monitor.sql','supabase/seed_templates.sql','supabase/migrations/002_employee_management.sql','supabase/migrations/003_evidence_and_live_updates.sql','tests/qa-support.sql'])await db.exec(await readFile(path,'utf8'));
 const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
 const outlets=['embassy-vasant','embassy-elan','kampai','basque'];
 for(const [i,id] of ids.entries()){await db.query('insert into auth.users values($1)',[id]);await db.query(`insert into profiles(id,name,email,role,restaurant_id) values($1,'QA Manager',$2,'manager',$3)`,[id,`qa-${run}-${i}@example.invalid`,outlets[i]]);}
 const prepared=await db.query('select qa_prepare($1,$2)',[run,ids]);assert.equal(prepared.rows[0].qa_prepare.length,16);
 assert.equal((await db.query('select count(*)::int as n from policies where enabled')).rows[0].n,0);
 assert.equal((await db.query('select qa_summary($1) as value',[run])).rows[0].value.managers.length,4);
 await db.exec('set role authenticated');await assert.rejects(db.query('select qa_prepare($1,$2)',[run,ids]),/permission denied/);await db.exec('reset role');
 const count=(await db.query('select qa_cleanup($1) as n',[run])).rows[0].n;assert.equal(count,4);
 for(const table of ['profiles','policies','occurrences','score_weeks'])assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from restaurants')).rows[0].n,4);
 await db.close();
});
