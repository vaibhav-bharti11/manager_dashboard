import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
test('production source contains no demo identities, fake clocks or bypass login',async()=>{
 for(const file of await readdir('src'))if(/\.(jsx|mjs)$/.test(file)){
  const source=await readFile('src/'+file,'utf8');
  assert.doesNotMatch(source,/\bdemo\b|demoReports|demoPolicies|demoRestaurants|Alex Morgan|Aarav Mehta|Diya Kapoor|Kabir Sethi|Ananya Rao/i,file);
 }
});
