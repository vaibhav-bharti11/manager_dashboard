import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
for(const name of ['employee-admin','phone-auth','report-evidence'])test(`${name} dashboard deployment is self-contained and valid TypeScript`,async()=>{
 const source=await readFile(`docs/${name}-deploy.ts`,'utf8');
 assert.doesNotMatch(source,/from\s*['"]\.{1,2}\//);
 const result=await transform(source,{loader:'ts',target:'es2022',format:'esm'});
 assert.ok(result.code.includes('Deno.serve'));
});
