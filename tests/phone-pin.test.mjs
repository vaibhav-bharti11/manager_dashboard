import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone,validatePin,hashPin,verifyPin,makeActivationCode,hashActivationCode} from '../supabase/functions/phone-auth/validation.mjs';

test('phone sign-in normalizes Indian local numbers and validates international format',()=>{
 assert.equal(normalizePhone('98765 43210'),'+919876543210');
 assert.equal(normalizePhone('+91 98765-43210'),'+919876543210');
 for(const value of ['','abcd','123','+1234567890123456'])assert.throws(()=>normalizePhone(value));
});
test('PIN is exactly four digits; salted hashes cannot serve as PINs',async()=>{
 for(const value of ['', 'abc', '000', '00000'])assert.throws(()=>validatePin(value));
 const pin=String(crypto.getRandomValues(new Uint16Array(1))[0]%10000).padStart(4,'0');
 const first=await hashPin(pin),second=await hashPin(pin);
 assert.notEqual(first.salt,second.salt);assert.notEqual(first.hash,second.hash);
 assert.equal(await verifyPin(pin,first),true);
 assert.equal(await verifyPin(String((Number(pin)+1)%10000).padStart(4,'0'),first),false);
 assert.notEqual(first.hash,pin);
});
test('activation codes are random and only a hash is stored',async()=>{
 const code=makeActivationCode();assert.ok(code.length>=24);assert.notEqual(code,makeActivationCode());
 const hash=await hashActivationCode(code);assert.equal(hash.length,64);assert.notEqual(hash,code);
});
