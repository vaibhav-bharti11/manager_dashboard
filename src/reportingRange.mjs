import { stateOf } from './policy.mjs';

export function indiaDate(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(now).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function historyStart(today = indiaDate()) {
  const [y,m,d] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y,m-7,1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d,lastDay));
  return first.toISOString().slice(0,10);
}
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') &&
  Number.isFinite(Date.parse(d+'T00:00:00Z')) && new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export function validateRange(from,to,today=indiaDate()) {
  if (!validDate(from)||!validDate(to)) return 'Choose a valid start and end date.';
  if (from>to) return 'The end date must be on or after the start date.';
  if (from<historyStart(today)||to>today) return 'Choose dates within the last six months, up to today.';
  return null;
}
export const inDateRange = (row,from,to) => row.business_date>=from && row.business_date<=to;
const unique = rows => [...new Map(rows.map(r=>[r.id ?? r.occurrence_id,r])).values()];
export function summarizeRange({users=[],reports=[],occurrences=[],ledger=[],from,to,now=new Date()}) {
  const selectedReports = unique(reports.filter(r=>inDateRange(r,from,to)));
  const selectedLedger = unique(ledger.filter(r=>inDateRange(r,from,to)));
  const submittedIds = new Set(selectedReports.map(r=>r.occurrence_id));
  const selectedOccurrences = unique(occurrences.filter(o=>o.enabled && inDateRange(o,from,to)));
  const status = o => submittedIds.has(o.id) ? 'Submitted' : stateOf(o,now);
  const count = rows => ({
    awaited:rows.filter(o=>['Open','Not yet open'].includes(status(o))).length,
    missed:rows.filter(o=>status(o)==='Missed').length,
  });
  const managerIds = new Set([...users.filter(u=>u.role==='manager').map(u=>u.id),
    ...selectedReports.map(r=>r.manager_id),...selectedOccurrences.map(o=>o.manager_id),...selectedLedger.map(l=>l.manager_id)]);
  const managers = [...managerIds].map(id=>{
    const user=users.find(u=>u.id===id);
    const rows=selectedLedger.filter(l=>l.manager_id===id);
    const historical=selectedReports.find(r=>r.manager_id===id)||selectedOccurrences.find(o=>o.manager_id===id)||rows[0];
    return {...user,id,name:user?.name||historical?.manager_name||'Former manager',
      restaurant_id:user?.restaurant_id||historical?.restaurant_id,
      submitted:selectedReports.filter(r=>r.manager_id===id).length,
      ...count(selectedOccurrences.filter(o=>o.manager_id===id)),
      earned:rows.filter(l=>l.amount>0).reduce((n,l)=>n+l.amount,0),
      net:rows.reduce((n,l)=>n+l.amount,0)};
  });
  return {submitted:selectedReports.length,...count(selectedOccurrences),
    scheduled:selectedOccurrences.length,managers};
}
export function rangeSeries(reports,from,to) {
  if (!validDate(from)||!validDate(to)||from>to) return [];
  const first=Date.parse(from+'T00:00:00Z'),days=Math.round((Date.parse(to+'T00:00:00Z')-first)/86400000)+1;
  const step=Math.max(1,Math.ceil(days/7));
  return Array.from({length:Math.ceil(days/step)},(_,i)=>{
    const start=new Date(first+i*step*86400000),end=new Date(first+Math.min(days,(i+1)*step)*86400000);
    return {label:start.toLocaleDateString('en-IN',{timeZone:'UTC',day:'numeric',month:'short'}),
      count:reports.filter(r=>r.business_date>=start.toISOString().slice(0,10)&&r.business_date<end.toISOString().slice(0,10)).length};
  });
}
