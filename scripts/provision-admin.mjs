// One-time owner-authorised setup. No secret is printed or bundled into the app.
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const config=JSON.parse(await readFile('.env.provision.local','utf8'));
await unlink('.env.provision.local');
const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:existing,error:readError}=await db.from('profiles').select('id').eq('role','admin').limit(1);
if(readError)throw new Error(readError.message);
if(existing.length){console.log('An administrator already exists. No credentials changed.');process.exit(0)}
const email='admin@service.local',password='Svc!'+randomBytes(18).toString('base64url');
const {data,error}=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Restaurant Administrator'}});
if(error)throw new Error(error.message);
const {error:profileError}=await db.from('profiles').insert({id:data.user.id,name:'Restaurant Administrator',email,role:'admin',restaurant_id:null});
if(profileError){await db.auth.admin.deleteUser(data.user.id);throw new Error(profileError.message)}
await writeFile('ADMIN_LOGIN.local.txt',`SERVICE ADMIN LOGIN\n\nEmail: ${email}\nPassword: ${password}\n\nOpen http://127.0.0.1:5173/\nThis file is private and excluded from Git.\n`,{mode:0o600});
console.log('Administrator created. Login is in the ignored ADMIN_LOGIN.local.txt file. Server key file removed.');
