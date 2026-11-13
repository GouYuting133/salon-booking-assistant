const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');const Core=require('./dist/booking-core.js');
const Services=require('./dist/service-core.js');
const LLM=require('./llm.cjs');const Catalog=require('./catalog.cjs');
const PREVIEW=process.env.SALON_PREVIEW_MODE==='1';
const DIST=path.join(__dirname,'dist'),DATA=process.env.SALON_DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(DATA,{recursive:true});
const keyPath=path.join(DATA,'admin.key');
const configuredAdminKey=process.env.SALON_ADMIN_KEY?.trim();
if(process.env.SALON_ADMIN_KEY!==undefined&&!/^[a-f0-9]{64}$/.test(configuredAdminKey))throw Error('SALON_ADMIN_KEY must contain 64 lowercase hexadecimal characters');
if(!configuredAdminKey&&!fs.existsSync(keyPath))fs.writeFileSync(keyPath,crypto.randomBytes(32).toString('hex'),{mode:0o600});
const adminKey=configuredAdminKey||fs.readFileSync(keyPath,'utf8').trim();
const sql=new DatabaseSync(path.join(DATA,'salon.sqlite'));sql.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,revision INTEGER,json TEXT);CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,customerId TEXT);CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,customerId TEXT,json TEXT,read INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,created TEXT,json TEXT);CREATE TABLE IF NOT EXISTS operation_receipts(id TEXT PRIMARY KEY,actor TEXT NOT NULL,revision INTEGER NOT NULL);');
const initial=()=>({consults:[],bookings:[],queue:[],blocks:[],pause:null,settings:{open:660,close:1320,short:25,medium:45,long:60,grace:20,buffer:0,lunchStart:0,lunchEnd:0,dinnerStart:1080,dinnerEnd:1140}});
if(!sql.prepare('SELECT id FROM state WHERE id=1').get())sql.prepare('INSERT INTO state VALUES(1,0,?)').run(JSON.stringify(Core.migrate(initial())));
const load=()=>{const r=sql.prepare('SELECT * FROM state WHERE id=1').get();return {revision:r.revision,db:JSON.parse(r.json)};};
function commit(db){const old=load();sql.prepare('INSERT INTO audit(created,json) VALUES(?,?)').run(new Date().toISOString(),JSON.stringify(old));sql.prepare('UPDATE state SET revision=revision+1,json=? WHERE id=1').run(JSON.stringify(db));for(const b of db.bookings.filter(b=>b.status==='confirmed')){const previous=old.db.bookings.find(x=>x.id===b.id);if(!previous||previous.day!==b.day||previous.start!==b.start||previous.status!=='confirmed'){const c=db.consults.find(c=>c.id===b.customerId||c.client===b.client&&b.client!=='merchant');notify(c?.id,'saved:'+b.id+':'+b.day+':'+b.start,`预约成功：${b.day} ${String(Math.floor(b.start/60)).padStart(2,'0')}:${String(b.start%60).padStart(2,'0')}，${b.title||'理发服务'}。`);}}return load();}
function transaction(fn){sql.exec('BEGIN IMMEDIATE');try{const value=fn();sql.exec('COMMIT');return value;}catch(e){sql.exec('ROLLBACK');throw e;}}
const startupState=load(),updatedState=Core.migrate(JSON.parse(JSON.stringify(startupState.db)));if(JSON.stringify(startupState.db)!==JSON.stringify(updatedState))transaction(()=>commit(updatedState));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
sql.exec("CREATE TABLE IF NOT EXISTS account_claims(hash TEXT PRIMARY KEY,customerId TEXT NOT NULL,expires INTEGER NOT NULL)");
const accounts=require('./customer-accounts.cjs')({
 sql,hash,transaction,
 createProfile(name){
  const {db}=load(),id=crypto.randomUUID();
  db.consults.push({id,client:crypto.randomUUID(),name:name||Services.anonymousLabel(id),anonymous:!name,project:'',hair:'',state:'draft',messages:[],serviceHistory:[]});
  commit(db);
  return id;
 },
 claimProfile(token){
  const claim=typeof token==='string'&&sql.prepare('SELECT customerId FROM account_claims WHERE hash=? AND expires>?').get(hash(token),Date.now());
  const {db}=load(),profile=claim&&db.consults.find(c=>c.id===claim.customerId);
  if(!profile||sql.prepare('SELECT 1 FROM customer_accounts WHERE customerId=?').get(profile.id))throw Object.assign(Error('此专属链接已失效或已绑定账号，请联系店主或使用已绑定账号登录'),{status:409});
  sql.prepare('DELETE FROM invites WHERE customerId=?').run(profile.id);
  sql.prepare('DELETE FROM account_claims WHERE customerId=?').run(profile.id);
  commit(db);
  return profile.id;
 },
 profileExists:id=>load().db.consults.some(c=>c.id===id)
});
sql.exec('CREATE TABLE IF NOT EXISTS owner_sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
function ownerKeyMatches(req){
 const value=Buffer.from(String(req.headers['x-admin-key']||''));
 const expected=Buffer.from(adminKey);
 return value.length===expected.length&&crypto.timingSafeEqual(value,expected);
}
function ownerSession(req){return /(?:^|;\s*)salon_owner=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie||'')?.[1];}
const ownerSessionHash=token=>crypto.createHmac('sha256',adminKey).update(token).digest('hex');
function owner(req){
 if(ownerKeyMatches(req))return true;
 const token=ownerSession(req);
 return !!(token&&sql.prepare('SELECT 1 FROM owner_sessions WHERE hash=? AND expires>?').get(ownerSessionHash(token),Date.now()));
}
const ownerSessionAge=30*24*60*60;
function renewOwnerSession(req,res){
 const token=ownerSession(req);if(!token)return;
 const now=Date.now();
 const updated=sql.prepare('UPDATE owner_sessions SET expires=? WHERE hash=? AND expires>?').run(now+ownerSessionAge*1000,ownerSessionHash(token),now);
 if(updated.changes)ownerCookie(req,res,token,ownerSessionAge);
}
function ownerCookie(req,res,token,age){
 const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');
 res.setHeader('Set-Cookie',`salon_owner=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${local?'':'; Secure'}`);
}
function customerTokenHash(req){const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1];return token?hash(token):null;}
function customer(req){const tokenHash=customerTokenHash(req);return tokenHash?(accounts.customerId(tokenHash)||sql.prepare('SELECT customerId FROM invites WHERE hash=?').get(tokenHash)?.customerId):null;}
function requireOwner(req){if(!owner(req))throw Object.assign(Error('请先登录商家端'),{status:401});}
function notify(customerId,id,text){if(customerId)sql.prepare('INSERT OR IGNORE INTO notifications(id,customerId,json) VALUES(?,?,?)').run(id,customerId,JSON.stringify({id,text,created:new Date().toISOString()}));}
function reminders(){
 const {db}=load(),now=Date.now(),rules=db.settings.reminders||{},lead=Number(rules.appointmentLead??20);
 for(const b of db.bookings){
  if(b.status!=='confirmed')continue;
  const at=String(Math.floor(b.start/60)).padStart(2,'0')+':'+String(b.start%60).padStart(2,'0'),start=Date.parse(b.day+'T'+at+':00+08:00');
  const c=db.consults.find(c=>c.id===b.customerId||c.client===b.client&&b.client!=='merchant');
  if(now>=start-lead*60000&&now<start)notify(c?.id,'before:'+b.id+':'+b.day+':'+b.start,`您预约的${b.title||'理发服务'}将于${b.day} ${at}开始，请按时到店。`);
  if(now>=start+20*60000&&now<start+86400000)notify(c?.id,'late:'+b.id+':'+b.day+':'+b.start,'预约时间已过，门店尚未确认您到店。如果行程有变，可到“我的预约”更改时间或取消；染烫改期请直接联系店主。');
 }
 if(rules.enabled===false)return;
 for(const c of db.consults){
  const p=Core.learn(c,db.bookings),day=Core.today();
  if(!p.next||c.followupPreference?.disabled||c.followupPreference?.until>day)continue;
  if(db.bookings.some(b=>(b.customerId===c.id||b.client===c.client&&b.client!=='merchant')&&Core.active.includes(b.status)))continue;
  if(day>=Core.addDay(p.next,-Number(rules.cycleLead??3))&&day<=Core.addDay(p.next,7))notify(c.id,'cycle:'+c.id+':'+p.next,`按您的理发记录，下次可以关注的时间约为${p.next}。如果觉得长度仍合适，可以继续保持；有需要时再查看理发计划。`);
 }
}
function customerView(id){const state=load(),c=state.db.consults.find(c=>c.id===id);if(!c)throw Error('客户档案不存在');const db=state.db,own=b=>b.customerId===id||b.client===c.client&&b.client!=='merchant';return {revision:state.revision,customerId:id,db:{works:(db.works||[]).filter(w=>w.published).map(({consent,...w})=>w),reviewLinks:db.reviewLinks,settings:db.settings,staffSchedule:db.staffSchedule,pause:db.pause,blocks:db.blocks,queue:[],consults:[c],bookings:db.bookings.filter(b=>own(b)||Core.active.includes(b.status)).map(b=>own(b)?b:{id:b.id,client:'busy',day:b.day,start:b.start,duration:b.duration,end:b.start+b.duration,staffId:b.staffId,status:b.status})},notifications:sql.prepare('SELECT json FROM notifications WHERE customerId=? AND read=0').all(id).map(r=>JSON.parse(r.json))};}
function validFuture(b){if(!/^\d{4}-\d{2}-\d{2}$/.test(b.day||'')||!Number.isInteger(b.start)||!Number.isInteger(b.duration)||b.duration<10||b.duration>480)throw Error('请检查预约日期、时间和时长');const now=Date.now(),at=Date.parse(b.day+'T'+String(Math.floor(b.start/60)).padStart(2,'0')+':'+String(b.start%60).padStart(2,'0')+':00+08:00');if(!Number.isFinite(at)||at<=now)throw Error('不能新增已过时的预约');}
const merchantProfileFields=['id','client','name','anonymous','phone','wechat','lastVisit','project','completedCareHistory','serviceHistory','autoReplyPaused'];
function merchantProfile(c){return Object.fromEntries(merchantProfileFields.filter(key=>Object.hasOwn(c,key)).map(key=>[key,c[key]]));}
function merchantView(state=load()){
 const accountPhones=new Map(sql.prepare('SELECT customerId,username FROM customer_accounts').all().map(a=>[a.customerId,a.username]));
 state.db.consults=state.db.consults.map(c=>{const profile=merchantProfile(c);if(profile.phone===accountPhones.get(c.id))delete profile.phone;return profile;});
 return state;
}
function validateOwnerState(next,old){
 if(!Array.isArray(next.consults)||!Array.isArray(next.bookings)||!next.settings)throw Error('数据格式不正确');
 if(next.settings.slotInterval!==undefined&&!Core.validSlotInterval(next.settings.slotInterval))throw Error('预约间隔请输入 1 至 1440 的整数分钟');
 if(next.works===undefined)next.works=old.works||[];
 if(next.staffSchedule?.weeklyClosedDays!==undefined&&(!Array.isArray(next.staffSchedule.weeklyClosedDays)||next.staffSchedule.weeklyClosedDays.some(d=>!Number.isInteger(d)||d<0||d>6)))throw Error('固定休息请选择有效的星期');
 const profiles=new Map(old.consults.map(c=>[c.id,c]));
 const accountPhones=new Map(sql.prepare('SELECT customerId,username FROM customer_accounts').all().map(a=>[a.customerId,a.username]));
 next.consults=next.consults.map(c=>{const prior=profiles.get(c.id),shared=merchantProfile(c);if(prior?.phone===accountPhones.get(c.id)&&prior?.phone&&!shared.phone)shared.phone=prior.phone;return {...c,...prior,...shared};});
 Core.migrate(next);
 const identities=new Set();for(const c of next.consults){if(typeof c.id!=='string'||!c.id||identities.has(c.id))throw Error('客户编号缺失或重复，请重新选择客户');identities.add(c.id);const name=String(c.name||'').trim();if(name.length>40)throw Error('客户称呼不能超过40字');c.name=name||Services.anonymousLabel(c.id);c.anonymous=!name||(c.anonymous===true&&name===Services.anonymousLabel(c.id));}
 next.works=next.works.map(w=>Catalog.validateWork(w));next.reviewLinks={meituan:Catalog.reviewLink(next.reviewLinks.meituan,'meituan'),douyin:Catalog.reviewLink(next.reviewLinks.douyin,'douyin')};
 for(const b of old.bookings){const n=next.bookings.find(x=>x.id===b.id);if(!n&&b.status!=='draft')throw Error('请取消预约，不可直接删除已有订单');}
 const original=next.bookings;next.bookings=[];
 for(const record of original){let b={...record,end:record.start+record.duration};const prev=old.bookings.find(x=>x.id===b.id);
  if(b.contactPhone&&!Services.validContactPhone(b.contactPhone))throw Error('联系电话请填写有效的11位手机号');
  if(Core.active.includes(b.status)){
   if(b.serviceId){const service=Services.find(b.serviceId);if(!service)throw Error('请选择有效的门店项目');if(!Number.isInteger(b.duration)||b.duration<10||b.duration>480)throw Error('服务时长请填写10至480分钟');b.project=service.category;if(!prev||prev.serviceId!==b.serviceId)b.title=service.name;b.isHaircut=service.isHaircut;}else if(b.project==='cut'&&(!prev||['day','start','duration','hair'].some(k=>prev[k]!==b[k])))b.duration=Core.cutDuration(b.hair);
   b.end=b.start+b.duration;
   const changed=!prev||!Core.active.includes(prev.status)||['day','start','duration','staffId'].some(k=>prev[k]!==b[k]);
   if(changed){validFuture(b);b=Core.allocate({...next,bookings:original.filter(x=>x.id!==b.id)},b,b.id);}
  }
  if(prev&&prev.status!==b.status){const allowed={confirmed:['arrived','cancelled'],arrived:['serving','cancelled'],serving:['done'],pending:['cancelled'],requested:['confirmed','cancelled']};if(!allowed[prev.status]?.includes(b.status))throw Error('不允许跳过到店、服务和完成步骤');if(!['cancelled','confirmed'].includes(b.status)&&b.day>Core.today())throw Error('未来订单不能提前完成');}
  let customer=b.customerId?next.consults.find(c=>c.id===b.customerId):next.consults.find(c=>b.client!=='merchant'&&c.client===b.client);if(b.customerId&&!customer)throw Error('客户编号不存在，请重新选择客户');if(!customer&&!prev){const id=crypto.randomUUID(),name=String(b.name||'').trim();customer={id,client:crypto.randomUUID(),name:name||Services.anonymousLabel(id),anonymous:!name,messages:[],serviceHistory:[],project:b.project};next.consults.push(customer);}if(customer){b.customerId=customer.id;if(!String(b.name||'').trim())b.name=customer.name;}
  next.bookings.push(b);
 }
 for(const b of next.bookings.filter(b=>b.status==='done')){const c=next.consults.find(c=>c.id===b.customerId||c.client===b.client&&b.client!=='merchant');if(!c)throw Error('已完成订单必须关联客户');c.serviceHistory=c.serviceHistory||[];if(!c.serviceHistory.some(r=>r.bookingId===b.id))c.serviceHistory.push({bookingId:b.id,day:b.day,start:b.start,project:b.project,serviceId:b.serviceId,title:b.title,isHaircut:b.isHaircut,hair:b.hair,duration:b.duration,staffId:b.staffId,status:'completed'});if(!c.lastVisit||b.day>c.lastVisit)c.lastVisit=b.day;}
 return next;
}
async function body(req,maxLength=4e6){let data='';req.setEncoding('utf8');for await(const chunk of req){data+=chunk;if(data.length>maxLength)throw Error('请求数据过大');}return data?JSON.parse(data):{};}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const chatEngine=require('./chat-engine.cjs').createEngine({load,commit,transaction,validFuture});
function chatContext(req,data={}){const id=customer(req);if(id)return {actor:'customer:'+id,customerId:id};requireOwner(req);if(data.mode==='customer')throw Object.assign(Error('请通过顾客账号使用专属助手'),{status:403});return {actor:'owner',customerId:null};}
function operationKey(data){const id=data.operationId;if(id===undefined)return null;if(typeof id!=='string'||!/^[-a-zA-Z0-9]{8,100}$/.test(id))throw Error('操作编号无效，请刷新后重试');return id;}
function replayOperation(id,actor){if(!id)return false;const r=sql.prepare('SELECT actor FROM operation_receipts WHERE id=?').get(id);if(!r)return false;if(r.actor!==actor)throw Object.assign(Error('操作编号不可复用'),{status:409});return true;}
function rememberOperation(id,actor){if(id)sql.prepare('INSERT INTO operation_receipts VALUES(?,?,?)').run(id,actor,load().revision);}
const server=http.createServer(async(req,res)=>{try{
 const origin=req.headers.origin;if(origin&&origin!=='http://'+req.headers.host&&origin!=='https://'+req.headers.host)throw Object.assign(Error('不接受其他站点的请求'),{status:403});
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(p==='/api/works'&&req.method==='PUT'){requireOwner(req);const data=await body(req);transaction(()=>{const db=load().db,work=Catalog.validateWork(data.work||{});if(!db.works.some(w=>w.id===work.id)&&db.works.length>=100)throw Error('最多保存100个作品');const index=db.works.findIndex(w=>w.id===work.id);if(index<0)db.works.push(work);else db.works[index]=work;commit(db);});return send(res,200,merchantView());}
 if(p==='/api/works/contact'&&req.method==='PUT'){requireOwner(req);const d=await body(req);transaction(()=>{const db=load().db;for(const k of ['phone','wechat']){if(typeof d[k]!=='string'||d[k].length>100)throw Error('请检查联系方式');db.settings[k]=d[k].trim();}db.reviewLinks={meituan:Catalog.reviewLink(d.meituan,'meituan'),douyin:Catalog.reviewLink(d.douyin,'douyin')};commit(db);});return send(res,200,merchantView());}
 if(p==='/api/health')return send(res,200,{ok:true});
 if(p==='/api/owner/session'&&req.method==='POST'){
  if(!ownerKeyMatches(req))return send(res,401,{error:'商家凭证无效'});
  const token=crypto.randomBytes(32).toString('base64url'),age=ownerSessionAge,now=Date.now();
  sql.prepare('DELETE FROM owner_sessions WHERE expires<=?').run(now);
  const previous=ownerSession(req);
  if(previous)sql.prepare('DELETE FROM owner_sessions WHERE hash=?').run(ownerSessionHash(previous));
  sql.prepare('INSERT INTO owner_sessions VALUES(?,?)').run(ownerSessionHash(token),now+age*1000);
  ownerCookie(req,res,token,age);
  return send(res,200,{ok:true});
 }
 if(p==='/api/owner/session'&&req.method==='DELETE'){
  const token=ownerSession(req);
  if(token)sql.prepare('DELETE FROM owner_sessions WHERE hash=?').run(ownerSessionHash(token));
  ownerCookie(req,res,'',0);
  return send(res,200,{ok:true});
 }
 if((p==='/api/accounts/register'||p==='/api/accounts/login')&&req.method==='POST')return send(res,p.endsWith('/register')?201:200,await accounts.authenticate(await body(req,4096),p.endsWith('/register')));
 if(p==='/api/accounts/logout'&&req.method==='POST'){const tokenHash=customerTokenHash(req);if(tokenHash)accounts.logout(tokenHash);return send(res,200,{ok:true});}
 if(p.startsWith('/api/operations/')&&req.method==='GET'){const id=operationKey({operationId:p.slice('/api/operations/'.length)}),customerId=customer(req);if(!customerId)requireOwner(req);const actor=customerId?'customer:'+customerId:'owner',r=sql.prepare('SELECT actor FROM operation_receipts WHERE id=?').get(id);return send(res,200,r?.actor===actor?{applied:true,...(customerId?customerView(customerId):merchantView())}:{applied:false});}
 if(p==='/api/model-status'&&req.method==='GET'){chatContext(req);const c=LLM.config();return send(res,200,{enabled:c.enabled,model:c.model||null,preview:PREVIEW});}
 if((p==='/api/chat'||p==='/api/chat/confirm')&&req.method==='POST'){const data=await body(req),ctx=chatContext(req,data);const result=p==='/api/chat'?await chatEngine.chat(data.text,ctx,data.selection):chatEngine.confirm(data.proposalId,ctx);return send(res,200,{...result,...(ctx.customerId?customerView(ctx.customerId):merchantView())});}
 if(p==='/api/customer/chat'&&req.method==='DELETE'){
  const id=customer(req);if(!id)throw Object.assign(Error('请先登录顾客端'),{status:401});
  chatEngine.clearChat('customer:'+id);
  transaction(()=>{const {db}=load(),profile=db.consults.find(c=>c.id===id);if(profile?.messages?.length){profile.messages=[];commit(db);}});
  return send(res,200,customerView(id));
 }
 if(p==='/api/merchant/chat'&&req.method==='DELETE'){
  requireOwner(req);
  chatEngine.clearChat('owner');
  const result=transaction(()=>{const state=load();if(!state.db.merchantMessages?.length)return state;state.db.merchantMessages=[];return commit(state.db);});
  return send(res,200,merchantView(result));
 }
 if(p==='/api/preview/reset'&&req.method==='POST'){requireOwner(req);if(!PREVIEW)throw Object.assign(Error('此操作仅允许在独立体验环境使用'),{status:403});const data=await body(req);transaction(()=>{const old=load();if(data.revision!==old.revision)throw Object.assign(Error('记录已更新，请刷新后重新确认清空'),{status:409});chatEngine.reset();const db=old.db;db.bookings=[];db.merchantMessages=[];db.queue=[];db.blocks=[];db.pause=null;db.settings.recordsEpoch=crypto.randomUUID();for(const c of db.consults){c.messages=[];c.serviceHistory=[];c.history='';c.lastVisit='';c.plan=null;c.state='draft';c.photo='';c.care='';c.followupPreference={};delete c.lastProject;}commit(db);sql.prepare('DELETE FROM notifications').run();});return send(res,200,merchantView());}
 if(p==='/api/state'){requireOwner(req);if(req.method==='GET'){if(url.searchParams.get('renew')==='1')renewOwnerSession(req,res);return send(res,200,merchantView());}if(req.method==='PUT'){const data=await body(req),operationId=operationKey(data);const result=transaction(()=>{if(replayOperation(operationId,'owner'))return load();const old=load();if(data.revision!==old.revision)throw Object.assign(Error('其他设备已更新日程，请重新检查后操作'),{status:409});const result=commit(validateOwnerState(data.db,old.db));rememberOperation(operationId,'owner');return result;});return send(res,200,merchantView(result));}}
 if(p==='/api/reschedule'&&req.method==='POST'){const customerId=customer(req);if(!customerId)requireOwner(req);const d=await body(req);transaction(()=>{const db=load().db,b=db.bookings.find(b=>b.id===d.bookingId),c=customerId?db.consults.find(c=>c.id===customerId):null;if(!b||customerId&&b.customerId!==customerId&&b.client!==c?.client)throw Error('未找到可操作的本人预约');if(b.status!=='confirmed'||b.project!=='cut')throw Error('仅未到店的洗剪吹预约可自助改期');if(d.expectedDay!==b.day||d.expectedStart!==b.start)throw Error('原预约已被修改，请关闭窗口后重新打开');const next={...b,day:d.day,start:d.start};delete next.staffId;validFuture(next);Object.assign(b,Core.allocate(db,next,b.id));commit(db);});return send(res,200,customerId?customerView(customerId):merchantView());}
 if(p==='/api/invites'&&req.method==='POST'){requireOwner(req);const data=await body(req);if(!load().db.consults.some(c=>c.id===data.customerId))throw Error('请先保存客户档案');const token=crypto.randomBytes(32).toString('base64url');if(sql.prepare('SELECT 1 FROM customer_accounts WHERE customerId=?').get(data.customerId))return send(res,200,{url:'/#customer'});if(data.claim){sql.prepare('INSERT INTO account_claims VALUES(?,?,?)').run(hash(token),data.customerId,Date.now()+7*86400000);return send(res,200,{url:'/customer-register.html#claim='+token});}sql.prepare('INSERT INTO invites VALUES(?,?)').run(hash(token),data.customerId);return send(res,200,{url:'/#customer&access='+token});}
 if(p.startsWith('/api/customer')){
  const id=customer(req);if(!id)throw Object.assign(Error('专属链接无效，请向店主重新获取'),{status:401});
  if(p==='/api/customer/state'&&req.method==='GET'){if(url.searchParams.get('renew')==='1')accounts.renew(customerTokenHash(req));reminders();return send(res,200,customerView(id));}
  if(p==='/api/customer/read'&&req.method==='POST'){const data=await body(req);for(const value of data.ids||[])sql.prepare('UPDATE notifications SET read=1 WHERE id=? AND customerId=?').run(value,id);return send(res,200,{ok:true});}
  if(p==='/api/customer/save'&&req.method==='POST'){const data=await body(req),operationId=operationKey(data);transaction(()=>{if(replayOperation(operationId,'customer:'+id))return;
   const {db}=load(),c=db.consults.find(c=>c.id===id);if(!c)throw Error('客户档案不存在');
   if(db.settings.recordsEpoch&&data.recordsEpoch!==db.settings.recordsEpoch)throw Object.assign(Error('体验记录已清空，请刷新后重新操作'),{status:409});
   const profile=data.profile||{};for(const key of ['name','hair','goal','preferredWindow','stylist','cycle','messages','followupPreference'])if(profile[key]!==undefined)c[key]=profile[key];
   if(typeof c.name!=='string'||c.name.length>40)throw Error('客户称呼不能超过40字');if(!c.name.trim()){c.name=Services.anonymousLabel(c.id);c.anonymous=true;}else if(c.name!==Services.anonymousLabel(c.id))c.anonymous=false;
   for(const incoming of data.bookings||[]){if(incoming.client!==c.client&&incoming.customerId!==id)continue;const existing=db.bookings.find(b=>b.id===incoming.id);if(existing){if(existing.customerId!==id&&existing.client!==c.client)throw Error('不能修改其他客户的预约');if(incoming.status==='cancelled'&&['confirmed','requested'].includes(existing.status))existing.status='cancelled';else if(existing.status==='confirmed'&&(incoming.day!==existing.day||incoming.start!==existing.start)){if(existing.project!=='cut')throw Error('染烫改期请联系店主');const proposed={...existing,day:incoming.day,start:incoming.start};delete proposed.staffId;validFuture(proposed);Object.assign(existing,Core.allocate(db,proposed,existing.id));}continue;}
    const service=incoming.serviceId?Services.find(incoming.serviceId):null;
    if(!service&&(incoming.serviceId||incoming.project!=='cut'))throw Error('请选择有效的门店项目');
    const requested=Services.needsOwnerConfirmation(service);
    const contactPhone=typeof incoming.contactPhone==='string'?incoming.contactPhone.trim():'';
    if(requested&&!Services.validContactPhone(contactPhone))throw Error('染发和烫发预约请填写有效的11位联系手机号');
    if(incoming.status!==(requested?'requested':'confirmed'))throw Error('预约状态无效，请刷新后重新提交');
    const duration=service?.duration??Core.cutDuration(incoming.hair);
    let b={id:incoming.id,customerId:id,client:c.client,name:c.name,project:service?.category||'cut',title:service?.name||'洗剪吹',day:incoming.day,start:incoming.start,duration,status:requested?'requested':'confirmed',created:Date.now()};
    if(service){b.serviceId=service.id;b.isHaircut=service.isHaircut;}
    else{b.hair=incoming.hair;c.hair=incoming.hair;}
    validFuture(b);b=Core.allocate(db,b);
    if(requested){delete b.staffId;b.contactPhone=contactPhone;}
    db.bookings.push(b);
   }commit(db);rememberOperation(operationId,'customer:'+id);
  });reminders();return send(res,200,customerView(id));}
  throw Object.assign(Error('接口不存在'),{status:404});
 }
 if(p.startsWith('/api/'))throw Object.assign(Error('接口不存在'),{status:404});
 if(req.method!=='GET')throw Object.assign(Error('不支持该操作'),{status:405});
 const target=path.resolve(DIST,'.'+decodeURIComponent(p==='/'?'/index.html':p));if(!target.startsWith(DIST+path.sep))throw Error('路径无效');
 const data=fs.readFileSync(target),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(target)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(data);
 }catch(e){send(res,e.status||400,{error:e.message});}});
if(require.main===module){const port=Number(process.env.PORT||8775),host=process.env.HOST||'127.0.0.1';server.listen(port,host,()=>{console.log(`预约系统：http://${host}:${port}/#merchant  商家凭证来源：${configuredAdminKey?'SALON_ADMIN_KEY':keyPath}`);if(process.argv.includes('--open')&&process.platform==='win32')require('node:child_process').spawn('cmd.exe',['/c','start','','http://127.0.0.1:'+port+'/#merchant'],{windowsHide:true,detached:true,stdio:'ignore'}).unref();});setInterval(()=>{try{reminders();}catch(e){console.error('提醒任务失败：'+e.message);}},15000).unref();}
module.exports={server,load,commit,transaction,validateOwnerState,customerView,reminders,sql};
