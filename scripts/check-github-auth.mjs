import {spawnSync} from 'node:child_process';
const result=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
const values=Object.fromEntries((result.stdout||'').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
if(!values.password){console.log('No noninteractive GitHub CLI credential is available. Browser upload remains available.');process.exit(0)}
const response=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+values.password,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'Service-restaurant-release'}});
const data=await response.json();console.log(response.ok?'GitHub CLI credential verified for '+data.login:'Stored GitHub credential did not authenticate.');
