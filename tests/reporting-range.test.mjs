import test from 'node:test';
import assert from 'node:assert/strict';
import { indiaDate, historyStart, validateRange, summarizeRange, rangeSeries } from '../src/reportingRange.mjs';
import { readPages } from '../src/pagination.mjs';

test('today and six-month limit use India dates and clamp month ends', () => {
  assert.equal(indiaDate(new Date('2026-10-29T18:30:00Z')), '2026-10-30');
  assert.equal(historyStart('2026-08-31'), '2026-02-28');
  assert.equal(historyStart('2028-08-31'), '2028-02-29');
  assert.equal(validateRange('2026-05-01','2026-10-30','2026-10-30'), null);
  assert.ok(validateRange('2026-02-30','2026-10-30','2026-10-30'));
  assert.ok(validateRange('2026-10-30','2026-10-29','2026-10-30'));
  assert.ok(validateRange('2026-04-01','2026-10-30','2026-10-30'));
});

const now = new Date('2026-10-30T12:00:00Z');
const occurrence = (id, manager_id, business_date, extra={}) => ({id,manager_id,restaurant_id:'r',business_date,enabled:true,opens_at:'2026-10-30T00:00:00Z',deadline:'2026-10-30T13:00:00Z',...extra});
const fixtures = {
  users:[{id:'a',name:'Manager A',role:'manager',restaurant_id:'r'},{id:'b',name:'Manager B',role:'manager',restaurant_id:'r'}],
  occurrences:[occurrence('1','a','2026-10-30'),occurrence('2','b','2026-10-30',{deadline:'2026-10-30T10:00:00Z'}),occurrence('3','b','2026-10-30',{opens_at:'2026-10-30T12:30:00Z'}),occurrence('4','a','2026-10-29'),occurrence('5','a','2026-10-30',{enabled:false})],
  reports:[{id:'report',occurrence_id:'1',manager_id:'a',restaurant_id:'r',business_date:'2026-10-30'}],
  ledger:[{id:1,manager_id:'a',restaurant_id:'r',business_date:'2026-10-30',amount:10,reason:'submitted',week_id:'old-cycle'},{id:2,manager_id:'b',restaurant_id:'r',business_date:'2026-10-30',amount:-20,reason:'missed',week_id:'new-cycle'},{id:3,manager_id:'a',restaurant_id:'r',business_date:'2026-10-29',amount:15,reason:'submitted'}],
};
test('selected day counts submitted, awaited (including not yet open), and missed', () => {
  const s=summarizeRange({...fixtures,from:'2026-10-30',to:'2026-10-30',now});
  assert.deepEqual([s.submitted,s.awaited,s.missed,s.scheduled],[1,1,1,3]);
  assert.deepEqual(s.managers.map(m=>[m.id,m.submitted,m.earned,m.missed,m.net]),[['a',1,10,0,10],['b',0,0,1,-20]]);
});
test('manager range history survives point cycle boundaries and does not mix accounts', () => {
  const s=summarizeRange({...fixtures,from:'2026-10-29',to:'2026-10-30',now});
  assert.equal(s.managers.find(m=>m.id==='a').earned,25);
  assert.equal(s.managers.find(m=>m.id==='b').earned,0);
  assert.equal(s.scheduled,4);
});
test('duplicates cannot inflate summaries and unknown historical managers remain visible', () => {
  const s=summarizeRange({...fixtures,users:[],reports:[...fixtures.reports,...fixtures.reports],ledger:[...fixtures.ledger,...fixtures.ledger],from:'2026-10-30',to:'2026-10-30',now});
  assert.equal(s.submitted,1);
  assert.equal(s.managers.find(m=>m.id==='a').earned,10);
  assert.equal(s.managers.length,2);
});
test('range chart includes all business dates, including single-day ranges',()=>{
  const series=rangeSeries(fixtures.reports,'2026-10-29','2026-10-30');
  assert.deepEqual(series.map(p=>p.count),[0,1]);
  assert.equal(rangeSeries(fixtures.reports,'2026-10-30','2026-10-30').length,1);
});
test('retained reports load past Supabase first-page limits',async()=>{
  const rows=Array.from({length:2205},(_,id)=>({id}));
  const loaded=await readPages(async(from,to)=>({data:rows.slice(from,to+1),error:null}));
  assert.equal(loaded.length,2205);
  assert.equal(loaded.at(-1).id,2204);
  await assert.rejects(()=>readPages(async()=>({error:new Error('unavailable')})),/unavailable/);
});
