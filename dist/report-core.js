(function(root){
 const Core=typeof module!=='undefined'?require('./booking-core.js'):root.SalonCore;
 function report(db,reference){const weekday=new Date(reference+'T12:00:00+08:00').getUTCDay(),from=Core.addDay(reference,-((weekday+6)%7)),to=Core.addDay(from,6);const bookings=db.bookings.filter(b=>b.status!=='draft'&&b.day>=from&&b.day<=to);
 const totals=rows=>({count:rows.length,done:rows.filter(b=>b.status==='done').length,cancelled:rows.filter(b=>b.status==='cancelled').length,unfinished:rows.filter(b=>Core.active.includes(b.status)).length,minutes:rows.filter(b=>b.status==='done').reduce((sum,b)=>sum+(Number(b.duration)||0),0)});
 const days=Array.from({length:7},(_,i)=>{const day=Core.addDay(from,i),rows=bookings.filter(b=>b.day===day).sort((a,b)=>a.start-b.start);return {day,rows,...totals(rows)};});
 return {from,to,...totals(bookings),days,staff:(db.staffSchedule?.staff||[]).map(s=>({...s,...totals(bookings.filter(b=>b.staffId===s.id))}))};
 }
 root.SalonReports={report};if(typeof module!=='undefined')module.exports=root.SalonReports;
})(globalThis);