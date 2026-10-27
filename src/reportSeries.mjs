function parts(now){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));}
export function reportSeries(reports,period,now=new Date()){
 const p=parts(now),day=`${p.year}-${p.month}-${p.day}`,date=new Date(day+'T00:00:00Z');
 if(period==='Today')return Array.from({length:6},(_,i)=>({label:`${(i*4)%12||12} ${i<3?'AM':'PM'}`,count:reports.filter(r=>{const x=parts(new Date(r.submitted_at));return `${x.year}-${x.month}-${x.day}`===day&&Math.floor(+x.hour/4)===i}).length}));
 const start=new Date(date);if(period==='This month')start.setUTCDate(1);else start.setUTCDate(start.getUTCDate()-start.getUTCDay());
 return Array.from({length:7},(_,i)=>{const a=new Date(start),b=new Date(start);if(period==='This month'){a.setUTCDate(1+i*5);b.setUTCDate(1+(i+1)*5);}else{a.setUTCDate(a.getUTCDate()+i);b.setUTCDate(b.getUTCDate()+i+1);}const first=a.toISOString().slice(0,10),next=b.toISOString().slice(0,10);return {label:a.toLocaleDateString('en-IN',{timeZone:'UTC',day:'numeric',month:'short'}),count:reports.filter(r=>r.business_date>=first&&r.business_date<next&&(period!=='This month'||r.business_date.slice(0,7)===day.slice(0,7))).length}});
}
