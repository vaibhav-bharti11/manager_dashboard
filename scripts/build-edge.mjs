import {readFile,writeFile} from 'node:fs/promises';
const stripImports=text=>text.replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']+\.mjs["'];?\s*/g,'');
for(const name of ['employee-admin','report-evidence','phone-auth']) {
 const files=name==='employee-admin'?['phone-auth/validation.mjs','employee-admin/validation.mjs']:[`${name}/validation.mjs`];
 const validation=(await Promise.all(files.map(f=>readFile('supabase/functions/'+f,'utf8')))).map(text=>stripImports(text).replaceAll('export ','')).join('\n');
 const source=stripImports(await readFile(`supabase/functions/${name}/index.ts`,'utf8'));
 await writeFile(`docs/${name}-deploy.ts`,validation+'\n'+source);
}
console.log('Prepared dashboard-deployable Edge Function sources.');
