// Explicitly run live QA with the owner's request. Does not run in npm test.
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const env=Object.fromEntries((await readFile('.env.local','utf8')).trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const config=JSON.parse(await readFile('.env.qa.local','utf8'));
const service=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const text=await readFile('ADMIN_LOGIN.local.txt','utf8');
const {error:loginError}=await admin.auth.signInWithPassword({email:text.match(/Email: (.+)/)[1],password:text.match(/Password: (.+)/)[1]});if(loginError)throw new Error(loginError.message);
const mode=process.argv[2]||'status';
const check=({data,error})=>{if(error)throw new Error(error.message);return data};
const run=mode==='setup'?{id:randomUUID(),managers:[],checks:[]}:JSON.parse(await readFile('QA_RUN.local.json','utf8'));
if(mode==='setup'){
 const restaurantIds=['embassy-vasant','embassy-elan','kampai','basque'];
 for(const [i,restaurant_id] of restaurantIds.entries()){
  const input={name:`QA Manager ${i+1}`,email:`qa-${run.id}-${i}@example.invalid`,password:'QA!'+randomBytes(18).toString('base64url'),restaurant_id};
  const {data,error}=await admin.functions.invoke('employee-admin',{body:input});if(error)throw new Error((await error.context.json()).error||error.message);
  run.managers.push({...data.employee,password:input.password});await writeFile('QA_RUN.local.json',JSON.stringify(run,null,2),{mode:0o600});
 }
 run.occurrences=check(await service.rpc('qa_prepare',{p_run:run.id,p_managers:run.managers.map(m=>m.id)}));
 await writeFile('QA_RUN.local.json',JSON.stringify(run,null,2),{mode:0o600});console.log('Four temporary QA managers and 16 open report occurrences prepared. Credentials remain in the ignored QA_RUN.local.json file.');
}else if(mode==='status'){
 const summary=check(await service.rpc('qa_summary',{p_run:run.id}));console.log(JSON.stringify(summary,null,2));
}else if(mode==='negative'){
 for(const m of run.managers){const client=createClient(config.url,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});check(await client.auth.signInWithPassword({email:m.email,password:m.password}));const other=run.managers.find(x=>x.restaurant_id!==m.restaurant_id),otherOccurrence=run.occurrences.find(o=>o.manager_id===other.id);assert.equal(check(await client.from('restaurants').select('*')).length,1);assert.equal(check(await client.from('reports').select('*').eq('restaurant_id',other.restaurant_id)).length,0);const denied=await client.rpc('submit_report',{p_occurrence:otherOccurrence.occurrence_id,p_data:{}});assert.ok(denied.error);const add=await client.functions.invoke('employee-admin',{body:{}});assert.ok(add.error);assert.equal(add.error.context.status,403);await client.auth.signOut({scope:'local'});}
 console.log('All four managers denied cross-restaurant reads/submissions and admin account creation.');
}else if(mode==='miss'){
 const count=check(await service.rpc('qa_miss',{p_run:run.id,p_manager:run.managers[0].id}));assert.equal(count,3);console.log('Exactly three missed penalties were recorded after two reconciliation calls.');
}else if(mode==='cleanup'){
 const summary=check(await service.rpc('qa_summary',{p_run:run.id}));const paths=summary.evidence.map(e=>e.object_path);if(paths.length)check(await service.storage.from('incident-evidence').remove(paths));
 const n=check(await service.rpc('qa_cleanup',{p_run:run.id}));
 for(const m of run.managers){const {error}=await service.auth.admin.deleteUser(m.id);if(error)throw new Error(error.message);}
 console.log(`Removed ${n} temporary manager profiles, their QA reports/points and ${paths.length} private test files.`);
 await unlink('QA_RUN.local.json');await unlink('.env.qa.local');
}else if(mode==='verify-complete'){
 const summary=check(await service.rpc('qa_summary',{p_run:run.id}));for(const m of summary.managers){assert.equal(m.reports,4);assert.equal(m.ledger_entries,4);assert.equal(m.score,140);}assert.ok(summary.evidence.length>=1);
 const first=run.managers[0],client=createClient(config.url,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});check(await client.auth.signInWithPassword({email:first.email,password:first.password}));
 for(const evidence of summary.evidence.filter(e=>e.uploaded_by===first.id)){const blob=check(await client.storage.from('incident-evidence').download(evidence.object_path));assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),evidence.sha256);}
 console.log('Verified: all four managers submitted all four forms; each has 140 points and exactly 4 reward entries. Stored evidence downloads match SHA-256.');await client.auth.signOut({scope:'local'});
}
await admin.auth.signOut({scope:'local'});
