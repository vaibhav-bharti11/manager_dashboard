import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const privateConfig=JSON.parse(await readFile('.env.qa.local','utf8'));
const env=Object.fromEntries((await readFile('.env.local','utf8')).split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const service=createClient(privateConfig.url,privateConfig.key,{auth:{persistSession:false,autoRefreshToken:false}});
const publicClient=()=>createClient(privateConfig.url,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const statePath='QA_UPDATES.local.json';
if(process.argv[2]!=='cleanup-auth'){
 const previous=await readFile(statePath,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e});
 if(previous?.accounts?.length)throw Error('A QA account is already tracked. Complete scoped cleanup before starting a new run.');
}
const pin=()=>String(crypto.getRandomValues(new Uint16Array(1))[0]%10000).padStart(4,'0');
const call=async(name,body,token)=>{
 const response=await fetch(privateConfig.url+'/functions/v1/'+name,{method:'POST',headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+(token||env.VITE_SUPABASE_ANON_KEY),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await response.json();return {status:response.status,data};
};
if(process.argv[2]==='cleanup-auth'){
 const state=JSON.parse(await readFile(statePath,'utf8'));
 for(const account of state.accounts){const {error}=await service.auth.admin.deleteUser(account.id);if(error)throw Error('QA Auth cleanup failed; private state retained.');}
 await unlink(statePath);await unlink('.env.qa.local');console.log('QA Auth accounts and local credential files removed.');process.exit(0);
}
const {data:admins,error:adminError}=await service.from('profiles').select('id').eq('role','admin').eq('active',true).limit(1);
assert.ifError(adminError);assert.ok(admins[0]);
const {data:identity,error:identityError}=await service.auth.admin.getUserById(admins[0].id);assert.ifError(identityError);
const {data:link,error:linkError}=await service.auth.admin.generateLink({type:'magiclink',email:identity.user.email});assert.ifError(linkError);
const adminClient=publicClient();const {data:adminAuth,error:sessionError}=await adminClient.auth.verifyOtp({type:'magiclink',token_hash:link.properties.hashed_token});assert.ifError(sessionError);
const adminToken=adminAuth.session.access_token;
const run=crypto.randomUUID().slice(0,8),state={run,accounts:[]};
await writeFile(statePath,JSON.stringify(state));
const writeCleanup=async()=>{
 const ids=state.accounts.map(a=>"'"+a.id+"'::uuid").join(',');if(!ids)return;
 await writeFile('QA_UPDATES_CLEANUP.local.sql',`begin;\ndelete from public.score_alerts where manager_id in (${ids});\ndelete from public.audit_log where actor in (${ids}) or after_value->>'employee_id' in (${state.accounts.map(a=>"'"+a.id+"'").join(',')});\ndelete from public.private_pin_credentials where user_id in (${ids});\ndelete from public.profiles where id in (${ids}) and name like 'QA updates ${run}%';\ncommit;\nselect count(*) as remaining_qa_profiles from public.profiles where id in (${ids});`);
};
const checks=[];
const makeAccount=async(index,restaurant)=>{
 const phone='+999'+Array.from(crypto.getRandomValues(new Uint8Array(10)),x=>x%10).join('');
 const result=await call('employee-admin',{name:'QA updates '+run+' '+index,phone,restaurant_id:restaurant},adminToken);
 if(result.status!==200)throw Error('Employee function failed: '+(result.data.error||result.status));
 const account={id:result.data.employee.id,phone,pin:pin(),activation_code:result.data.activation_code};state.accounts.push(account);await writeFile(statePath,JSON.stringify(state));await writeCleanup();
 return account;
};
const first=await makeAccount(1,'kampai');checks.push('admin creates phone-based manager and one-time code');
const activated=await call('phone-auth',{action:'activate',phone:first.phone,pin:first.pin,activation_code:first.activation_code});
assert.equal(activated.status,200,'Phone activation failed: '+(activated.data.error||activated.status));assert.ok(activated.data.session?.access_token);
first.token=activated.data.session.access_token;checks.push('activation sets own PIN and creates a real session');
let result=await call('phone-auth',{action:'activate',phone:first.phone,pin:first.pin,activation_code:first.activation_code});assert.equal(result.status,401);checks.push('activation code cannot be reused');
result=await call('phone-auth',{action:'login',phone:first.phone,pin:first.pin});assert.equal(result.status,200);first.token=result.data.session.access_token;checks.push('phone and PIN sign-in works');
const managerClient=publicClient();await managerClient.auth.setSession({access_token:result.data.session.access_token,refresh_token:result.data.session.refresh_token});
const {data:profile,error:profileError}=await managerClient.from('profiles').select('*');assert.ifError(profileError);assert.ok(profile.length===1&&profile[0].id===first.id&&profile[0].pin_ready);
const denied=await managerClient.rpc('reset_points',{p_restaurant:'kampai'});assert.ok(denied.error);checks.push('manager cannot reset restaurant points or read other profiles');
let next=pin();while(next===first.pin)next=pin();
result=await call('phone-auth',{action:'change_pin',current_pin:first.pin,new_pin:next},first.token);assert.equal(result.status,200);
const old=await call('phone-auth',{action:'login',phone:first.phone,pin:first.pin});assert.equal(old.status,401);
first.pin=next;await writeFile(statePath,JSON.stringify(state));
result=await call('phone-auth',{action:'login',phone:first.phone,pin:first.pin});assert.equal(result.status,200);first.token=result.data.session.access_token;checks.push('only signed-in owner changes PIN; old PIN stops working');
const forbidden=await managerClient.from('private_pin_credentials').select('*');assert.ok(forbidden.error);checks.push('PIN hashes and activation credentials stay inaccessible to managers');
const deactivated=await adminClient.rpc('set_account_active',{p_user:first.id,p_active:false});assert.ifError(deactivated.error);
result=await call('phone-auth',{action:'login',phone:first.phone,pin:first.pin});assert.equal(result.status,401);
const blocked=await managerClient.rpc('submit_report',{p_occurrence:crypto.randomUUID(),p_data:{}});assert.match(blocked.error?.message||'',/deactivated/);checks.push('admin deactivation blocks sign-in and an existing session');
const restored=await adminClient.rpc('set_account_active',{p_user:first.id,p_active:true});assert.ifError(restored.error);
result=await call('phone-auth',{action:'login',phone:first.phone,pin:first.pin});assert.equal(result.status,200);first.session=result.data.session;await writeFile(statePath,JSON.stringify(state));checks.push('restoring access keeps the same manager identity');
const ids=state.accounts.map(a=>"'"+a.id+"'::uuid").join(',');
await writeFile('QA_UPDATES_CLEANUP.local.sql',`begin;\ndelete from public.score_alerts where manager_id in (${ids});\ndelete from public.audit_log where actor in (${ids}) or after_value->>'employee_id' in (${state.accounts.map(a=>"'"+a.id+"'").join(',')});\ndelete from public.private_pin_credentials where user_id in (${ids});\ndelete from public.profiles where id in (${ids}) and name like 'QA updates ${run}%';\ncommit;\nselect count(*) as remaining_qa_profiles from public.profiles where id in (${ids});`);
await writeFile('docs/updates-cloud-verification.json',JSON.stringify({verified_at:new Date().toISOString(),checks},null,2));
console.log(checks.map(c=>'PASS: '+c).join('\n'));
console.log('Run scoped QA cleanup SQL, then cleanup-auth after browser checks. No PINs or tokens were logged.');
