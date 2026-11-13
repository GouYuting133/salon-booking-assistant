(function(root){
 const Services=root.SalonServices||(typeof require==='function'?require('./service-core.js'):null);
 const active=['confirmed','arrived','serving'];
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const addDay=(d,n)=>{const t=new Date(d+'T12:00:00+08:00');t.setUTCDate(t.getUTCDate()+n);return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);};
 const overlap=(a,b,c,d)=>a<d&&b>c;
 function cutDuration(hair){if(hair==='short')return 25;if(hair==='long')return 45;throw Error('请确认本次剪发是短发还是长发');}
 function isWeeklyClosed(db,day){return (db.staffSchedule?.weeklyClosedDays||[]).includes(new Date(day+'T12:00:00+08:00').getUTCDay());}
 const validSlotInterval=value=>Number.isInteger(value)&&value>=1&&value<=1440;
 const slotInterval=db=>validSlotInterval(db.settings.slotInterval)?db.settings.slotInterval:30;
 function schedule(db,day){const p=db.staffSchedule?.overrides?.[day]||{};return {...db.settings,lunchStart:0,lunchEnd:0,...p,closed:isWeeklyClosed(db,day),staff:(db.staffSchedule?.staff||[]).map(x=>({...x,...p.staff?.[x.id]}))};}
 function availableStaff(db,day,start,duration,except,desired){
  const s=schedule(db,day),end=start+duration;
  if(s.closed)return [];
  if(!Number.isInteger(start)||!Number.isInteger(duration)||duration<1||start<s.open||end>s.close)return [];
  if([[s.lunchStart,s.lunchEnd],[s.dinnerStart,s.dinnerEnd]].some(([a,b])=>a<b&&overlap(start,end,a,b)))return [];
  if((db.staffSchedule?.closures||[]).some(x=>x.day===day&&((!x.start&&!x.end)||overlap(start,end,x.start,x.end))))return [];
  if(db.pause?.day===day&&overlap(start,end,db.pause.from,db.pause.to))return [];
  const bookings=db.bookings.filter(b=>b.id!==except&&b.day===day&&active.includes(b.status));
  const blocks=(db.blocks||[]).filter(b=>b.day===day&&!b.removed&&b.id!==except);
  return s.staff.filter(p=>p.enabled!==false&&(!desired||p.id===desired)&&start>=p.start&&end<=p.end
   &&!bookings.some(b=>(!b.staffId||b.staffId===p.id)&&overlap(start,end,b.start,b.start+b.duration))
   &&!blocks.some(b=>(!b.staffId||b.staffId===p.id)&&overlap(start,end,b.start,b.end)));
 }
 function allocate(db,b,except){const staff=availableStaff(db,b.day,b.start,b.duration,except,b.staffId)[0];if(!staff)throw Error('该理发师或时段已无空位，请重新选择');return {...b,staffId:staff.id,end:b.start+b.duration};}
 function transition(db,id,next){
  const b=db.bookings.find(x=>x.id===id);if(!b)throw Error('未找到预约');
  const allowed={confirmed:['arrived','cancelled'],arrived:['serving','cancelled'],serving:['done']};
  if(!allowed[b.status]?.includes(next))throw Error('状态已变化，请按预约成功、已到店、服务中、已完成的顺序操作');
  if(next!=='cancelled'&&b.day>today())throw Error('未来预约不能提前确认到店或完成');
  const customer=next==='done'?db.consults.find(c=>c.id===b.customerId||c.client===b.client&&b.client!=='merchant'):null;
  if(next==='done'&&!customer)throw Error('请先将预约关联到客户档案');
  b.status=next;b[next+'At']=new Date().toISOString();
  if(next==='done'){
   const c=customer;
   c.serviceHistory=c.serviceHistory||[];
   if(!c.serviceHistory.some(r=>r.bookingId===b.id))c.serviceHistory.push({bookingId:b.id,day:b.day,start:b.start,project:b.project,serviceId:b.serviceId,title:b.title,isHaircut:b.isHaircut,hair:b.hair,duration:b.duration,staffId:b.staffId,status:'completed'});
   if(!c.lastVisit||b.day>c.lastVisit)c.lastVisit=b.day;
  }return b;
 }
 function learn(c,bookings){
  const records=[...(c.serviceHistory||[]).filter(r=>!r.status||['done','completed'].includes(r.status)),...bookings.filter(b=>(b.customerId===c.id||b.client===c.client&&b.client!=='merchant')&&b.status==='done')].filter(r=>r.day&&r.day<=today());
  const cuts=records.filter(r=>r.isHaircut!==false&&(r.project==='cut'||r.projects?.includes('cut')));
  const dates=[...new Set(cuts.map(r=>r.day))].sort();
  const gaps=dates.slice(1).map((d,i)=>Math.round((Date.parse(d)-Date.parse(dates[i]))/86400000)).filter(n=>n>=7&&n<=180).sort((a,b)=>a-b);
  const median=a=>a.length%2?a[(a.length-1)/2]:Math.round((a[a.length/2-1]+a[a.length/2])/2);
  const cycle=gaps.length>=2?median(gaps):null;
  const timed=new Map();for(const r of records)if(Number.isFinite(r.start))timed.set(r.bookingId||r.id||r.day,r.start);
  const buckets=[...timed.values()].map(t=>t<720?'上午':t<1080?'下午':'晚上'),counts={};for(const b of buckets)counts[b]=(counts[b]||0)+1;
  const window=buckets.length>=3?Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]:null;
  return {cycle,window,visits:dates.length,last:dates.at(-1)||c.lastVisit||null,source:cycle?'实际到店记录中位间隔':c.cycle?'客户设定周期':'记录不足',next:dates.length&&cycle?addDay(dates.at(-1),cycle):c.lastVisit&&c.cycle?addDay(c.lastVisit,Number(c.cycle)):null};
 }
 function migrate(db){
  if(db.settings.ownerInfoVersion!=='20261028'){Object.assign(db.settings,{storeName:'简爱美发造型沙龙',phone:'19219866990',wechat:'dbb55333',showPrices:false,ownerInfoVersion:'20261028'});db.settings.careRules={...db.settings.careRules,colorText:db.settings.careRules?.colorText||'',permText:db.settings.careRules?.permText||'',colorDays:null,colorMonths:2,colorCareDays:7,permDays:7};}
  if(db.settings.ownerCareVersion!=='20261101'){db.settings.careRules={...db.settings.careRules,colorText:"染发后注意事项⚠️\n1. 染后48小时内尽量不要洗头，给色素稳定的时间；\n2. 洗头用温水，不要用很烫的水，高温会加速掉色；\n3. 优先用护色洗发水，护发素、发膜只涂抹发中发尾，不要堆在头皮；\n4. 少长时间暴晒，紫外线会让发色褪得更快；\n5. 前3天尽量不要扎很紧的头发、不要反复用高温夹板/卷发棒；\n6. 粗硬发质前期轻微浮色属于正常现象；漂过的受损发质掉色会更快，尽量减少高温造型；\n7. 不要频繁用去屑、清洁力很强的洗发水，容易带走色素。",permText:"烫发后注意事项⚠️\n1. 烫完48小时内不要洗头，不要扎紧头发、别耳后，避免压出折痕，卷度容易变形；\n2. 洗头用温水，不要用很烫的水；\n3. 洗完头发低头，顺着卷度抓着吹到八成干，抹少量弹力素；不要用密齿梳使劲梳开卷；\n4. 尽量少用高温夹板，会破坏卷的弹性；\n5. 沙发、受损发质卷更容易干毛，搭配少量发油保湿；\n6. 不要频繁去抠揉搓卷，湿发的时候不要用力拉扯。",straightText:'拉直后注意事项：做完三天内不要扎马尾、别耳后，避免留下折痕。'};db.settings.ownerCareVersion='20261101';}
  db.settings.buffer=0;db.settings.grace=20;db.settings.short=25;db.settings.long=45;db.settings.medium=45;
  if(!db.settings.address)db.settings.address='南昌市新建区双港东大街82号';
  for(const c of db.consults||[]){if(c.id&&!String(c.name||'').trim()){c.name=Services.anonymousLabel(c.id);c.anonymous=true;}}
  db.works=db.works||[];db.reviewLinks=db.reviewLinks||{meituan:'',douyin:''};
  db.staffSchedule=db.staffSchedule||{staff:[{id:'owner',name:'店主',start:db.settings.open,end:db.settings.close,enabled:true},{id:'assistant',name:'兼职助理',start:1020,end:1320,enabled:true}],closures:[]};
  db.staffSchedule.weeklyClosedDays=db.staffSchedule.weeklyClosedDays||[];
  for(const b of db.bookings){b.end=b.start+b.duration;if(b.status==='pending'){b.status='cancelled';b.reason='旧版未确认记录，需店主重新登记；原记录已保留';}}
  return db;
 }
 root.SalonCore={services:Services,active,today,addDay,isWeeklyClosed,schedule,slotInterval,validSlotInterval,availableStaff,allocate,transition,learn,migrate,cutDuration};
 if(typeof module!=='undefined')module.exports=root.SalonCore;
})(globalThis);
