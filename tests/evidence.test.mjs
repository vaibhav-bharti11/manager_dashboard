import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidence} from '../supabase/functions/report-evidence/validation.mjs';
const png=new Uint8Array([137,80,78,71,13,10,26,10,0]);
test('evidence validates bytes against type and returns a safe extension',()=>{
 assert.equal(validateEvidence(png,'image/png',png.length),'png');
 assert.equal(validateEvidence(new TextEncoder().encode('%PDF-1.4'),'application/pdf',8),'pdf');
 assert.equal(validateEvidence(new Uint8Array([255,216,255,0]),'image/jpeg',4),'jpg');
});
test('evidence rejects type spoofing, unsupported files, empty and oversized uploads',()=>{
 assert.throws(()=>validateEvidence(png,'image/jpeg',png.length),/content/);
 assert.throws(()=>validateEvidence(png,'text/html',png.length),/PNG/);
 assert.throws(()=>validateEvidence(png,'image/png',11*1024*1024),/10 MB/);
 assert.throws(()=>validateEvidence(new Uint8Array(),'image/png',0),/empty/);
});
