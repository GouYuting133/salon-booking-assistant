(function(){
 if(!/^https?:$/.test(location.protocol))return;
 document.documentElement.classList.add('network-pending');
 const customerRoute=location.hash==='#customer'||location.hash.startsWith('#customer&');
 const inviteToken=customerRoute?(location.hash.match(/&access=([^&]+)/)?.[1]||sessionStorage.getItem('salon-client-token')):null;
 const accountStorageKey='salon-account-token';
 const accountToken=customerRoute&&!inviteToken?(localStorage.getItem(accountStorageKey)||sessionStorage.getItem(accountStorageKey)):null;
 const token=inviteToken||accountToken,clientMode=!!token,entryUrl='/customer-register.html';
 if(customerRoute&&!clientMode){location.replace(entryUrl);return;}
 if(inviteToken)sessionStorage.setItem('salon-client-token',inviteToken);
 if(!clientMode)document.documentElement.classList.add('network-merchant');
 let key=clientMode?'':sessionStorage.getItem('salon-admin-key')||'',ready=false,lastError='',revision=0,pending=0,queue=Promise.resolve(),epoch=0;
 let bookingLink=null,savedBooking=null,proposal=null,chatBusy=false,modelEnabled=false,previewMode=false;
 const headers=()=>({'Content-Type':'application/json',...(clientMode?{Authorization:'Bearer '+token}:{'X-Admin-Key':key})});
 async function api(path,method='GET',data){return SalonHTTP.request(new URL(path,location.href).href,{method,headers:headers(),body:data?JSON.stringify(data):undefined,timeoutMs:path==='/api/chat'?65000:15000});}
 function status(text){const el=document.querySelector('#network-status');if(el)el.textContent=text;}
 function leaveAccount(){localStorage.removeItem(accountStorageKey);sessionStorage.removeItem(accountStorageKey);location.replace(entryUrl);}
 function notices(list){const el=document.querySelector('#network-notices');if(!el||!clientMode||!list?.length)return;for(const n of list){if(!el.querySelector('[data-notification="'+n.id.replace(/[^a-zA-Z0-9:-]/g,'')+'"]')){const line=document.createElement('p');line.dataset.notification=n.id.replace(/[^a-zA-Z0-9:-]/g,'');line.textContent=n.text;el.prepend(line);}try{if('Notification'in window&&Notification.permission==='granted')new Notification('理发预约提醒',{body:n.text,tag:n.id});}catch{}}
  if(document.visibilityState==='visible'||'Notification'in window&&Notification.permission==='granted')api('/api/customer/read','POST',{ids:list.map(n=>n.id)}).catch(()=>{});
 }
 function install(result){if(result.db&&db.settings?.recordsEpoch!==result.db.settings?.recordsEpoch){resetChatDrafts();proposal=null;}revision=result.revision;if(result.db){db=result.db;if(clientMode){client=db.consults[0].client;view='customer';document.documentElement.classList.add('network-customer');}try{render();}catch(err){console.error('界面刷新失败',err);status('后台数据已读取，但页面刷新异常，请重新打开网页，勿重复添加预约');}}try{notices(result.notifications);}catch(err){console.error('提醒显示失败',err);}}
 async function pull(){if(!ready||pending||chatBusy||document.querySelector('.modal-backdrop')||document.activeElement?.matches('input,textarea,select'))return;try{const r=await api(clientMode?'/api/customer/state':'/api/state');if(r.revision!==revision)install(r);else notices(r.notifications);lastError='';status('已连接 · '+(clientMode?'客户专属入口':'商家工作台'));}catch(e){lastError=e.message;status('连接中断：'+e.message+'；暂未同步，请勿重复提交');}}
 async function recover(){if(!lastError)return;const r=await api(clientMode?'/api/customer/state':'/api/state');install(r);lastError='';status('已恢复连接，请核对日程和聊天记录');}
 async function waitForSync(){await queue;await recover();}
 async function boot(){
  if(!clientMode){
   document.querySelector('header .brand').setAttribute('href','#merchant');
   document.title='理发店助手 · 商家工作台';
  }
  const baseRender=render;render=function(){view=clientMode?'customer':'merchant';baseRender();const form=document.querySelector(view==='merchant'?'#merchant-chat-form':'#chat-form');if(!form)return;if(ready&&(clientMode?getConsult().messages?.length:db.merchantMessages?.length))form.insertAdjacentHTML('beforebegin','<button type="button" class="secondary" data-clear-merchant-chat>清空聊天记录</button>');if(ready&&!clientMode&&!modelEnabled)form.insertAdjacentHTML('beforebegin','<div class="summary">对话暂不可用。可先到预约页手动登记，已输入的内容会保留。 <button type="button" data-action="merchant-panel" data-value="orders">前往预约</button></div>');if(chatBusy)form.insertAdjacentHTML('beforebegin','<p class="muted" role="status">助手正在理解，请稍等…</p>');if(savedBooking&&!clientMode)form.insertAdjacentHTML('beforebegin','<section class="summary"><b>预约已保存</b> <button type="button" data-chat-invite>生成客户专属链接</button>'+(bookingLink?'<p><input readonly aria-label="客户专属链接" value="'+esc(bookingLink)+'"></p><button type="button" data-chat-copy>复制链接</button>':'')+'</section>');if(proposal?.selectService&&!clientMode)form.insertAdjacentHTML('beforebegin','<section class="summary"><b>基础洗护剪</b><div class="actions">'+SalonCore.services.list.filter(s=>s.category==='cut').map(s=>'<button type="button" data-chat-service="'+s.id+'">'+esc(s.name)+' · '+s.duration+'分钟</button>').join('')+'</div></section>');else if(proposal&&proposal.mode===(view==='merchant'?'merchant':'customer'))form.insertAdjacentHTML('beforebegin','<section class="summary chat-proposal"><b>请核对后执行</b><p>'+esc(proposal.summary)+'</p><button type="button" data-chat-confirm>确认执行</button><button type="button" class="secondary" data-chat-dismiss>暂不执行</button></section>');};
  document.addEventListener('click',async e=>{const service=e.target.closest('[data-chat-service]');if(service&&proposal?.selectService&&!chatBusy){service.disabled=true;try{await SalonNetwork.chat('选择项目：'+SalonCore.services.find(service.dataset.chatService).name,'merchant',{id:proposal.id,serviceId:service.dataset.chatService});}catch(err){toast(err.message);}finally{render();}return;}const invite=e.target.closest('[data-chat-invite],[data-chat-copy]');if(invite&&savedBooking&&!clientMode){invite.disabled=true;try{if(invite.hasAttribute('data-chat-copy')){await navigator.clipboard.writeText(bookingLink);toast('链接已复制');}else{bookingLink=await SalonNetwork.invite(savedBooking.customerId,true);render();}}catch(err){toast(err.message);}finally{invite.disabled=false;}return;}const button=e.target.closest('[data-chat-confirm],[data-chat-dismiss]');if(!button)return;e.preventDefault();if(button.hasAttribute('data-chat-dismiss')){proposal=null;render();return;}if(chatBusy||!proposal)return;button.disabled=true;chatBusy=true;try{await queue;const result=await api('/api/chat/confirm','POST',{proposalId:proposal.id,mode:proposal.mode,customerId:proposal.customerId});proposal=null;lastError='';if(result.savedBooking){savedBooking=result.savedBooking;bookingLink=null;}install(result);status('已保存到服务器，日程已更新');}catch(err){status((err.networkIssue?'执行结果暂未确认，请先查看日程：':'未执行：')+err.message);}finally{chatBusy=false;render();}});
  document.addEventListener('click',async event=>{
   const button=event.target.closest('[data-clear-merchant-chat]');
   if(!button||!ready||chatBusy||!confirm(clientMode?'清空你的聊天记录？预约和到店记录会保留。':'清空商家端的聊天记录？预约和顾客对话会保留。'))return;
   button.disabled=true;chatBusy=true;
   try{await waitForSync();const result=await api(clientMode?'/api/customer/chat':'/api/merchant/chat','DELETE');proposal=null;install(result);toast('聊天记录已清空');}
   catch(error){toast(error.message);}
   finally{chatBusy=false;render();}
  });
  const originalSave=save,localCopy=JSON.parse(JSON.stringify(db));refresh=()=>{};
  const box=document.createElement('section');box.className='network-panel';box.innerHTML=clientMode?'<b>客户专属服务</b><span id="network-status">正在连接门店…</span><button id="enable-notifications" type="button">开启预约提醒</button><div id="network-notices" role="status"></div>':'<b>联网工作台</b><form id="network-login"><label>商家凭证<input id="network-key" type="password" autocomplete="off" placeholder="填写部署时设置的商家凭证"></label><label class="check"><input id="network-import" type="checkbox">首次启用时导入本机现有资料</label><label class="check"><input id="network-remember" type="checkbox" checked>记住此设备 30 天（打开自动续期）</label><button>连接后台</button></form><span id="network-status">请先登录商家端。客户通过专属链接进入。</span><div id="network-notices"></div>';
  document.body.prepend(box);const reconnect=document.createElement('button');reconnect.type='button';reconnect.textContent='重新连接';reconnect.className='secondary';reconnect.id='network-reconnect';reconnect.onclick=()=>connect();box.appendChild(reconnect);
  if(accountToken){
   const logout=document.createElement('button');
   logout.type='button';logout.className='secondary';logout.textContent='退出账号';
   logout.onclick=async()=>{logout.disabled=true;try{await queue;await api('/api/accounts/logout','POST');}catch{}finally{leaveAccount();}};
   box.appendChild(logout);
  }
  if(!clientMode)document.addEventListener('click',async event=>{
   if(!event.target.closest('[data-copy-customer-entry]')||!ready)return;
   const link=new URL(entryUrl,location.href).href;
   try{await navigator.clipboard.writeText(link);toast('已复制新客户注册链接');}
   catch{window.prompt('复制这个链接发给新客户',link);}
  });
  save=function(){if(!clientMode)originalSave();if(!ready){status('尚未连接后台，当前操作未同步');return;}const snapshot=JSON.parse(JSON.stringify(db)),jobEpoch=epoch,operationId=uid();if(!clientMode)delete snapshot.works;pending++;status('正在保存到服务器…');queue=queue.then(async()=>{if(jobEpoch!==epoch){pending--;return;}try{lastError='';const result=await api(clientMode?'/api/customer/save':'/api/state',clientMode?'POST':'PUT',clientMode?{operationId,recordsEpoch:snapshot.settings.recordsEpoch,profile:snapshot.consults[0],bookings:snapshot.bookings.filter(b=>b.client===client||b.customerId===snapshot.consults[0].id)}:{operationId,revision,db:snapshot});revision=result.revision;if(pending===1)install(result);status('已保存到服务器');}catch(e){let verified=null;if(e.networkIssue)try{const receipt=await api('/api/operations/'+encodeURIComponent(operationId));if(receipt.applied)verified=receipt;}catch{}if(verified){lastError='';revision=verified.revision;if(pending===1)install(verified);status('已保存到服务器（已重新核实）');}else{lastError=e.message;epoch++;try{install(await api(clientMode?'/api/customer/state':'/api/state'));}catch{}status((e.networkIssue?'保存结果暂未确认，请先核对日程，勿重复添加：':'未保存：')+e.message);}}finally{pending--;}});return queue;};
  async function connect(){try{if(!clientMode&&key&&/[^\x21-\x7e]/.test(key))throw Error('请粘贴完整的商家凭证');const result=await api(clientMode?'/api/customer/state?renew=1':'/api/state?renew=1');if(!clientMode&&document.querySelector('#network-import')?.checked&&result.db.bookings.length===0&&result.db.consults.length===0){const imported=await api('/api/state','PUT',{revision:result.revision,db:SalonCore.migrate(localCopy)});install(imported);}else install(result);if(accountToken){localStorage.setItem(accountStorageKey,accountToken);sessionStorage.removeItem(accountStorageKey);}const modelStatus=await api('/api/model-status');modelEnabled=modelStatus.enabled;previewMode=!!modelStatus.preview;const resetButton=document.querySelector('[data-action="reset"]');if(resetButton)resetButton.textContent=previewMode?'清空聊天与预约记录':'清除本机缓存';ready=true;if(!clientMode){if(key)sessionStorage.setItem('salon-admin-key',key);document.querySelector('#network-login').style.display='none';document.querySelector('#network-key').value='';}document.documentElement.classList.remove('network-pending');lastError='';const label=document.querySelector('.experience');if(label)label.textContent=modelEnabled?'联网预约系统 · 已配置 '+modelStatus.model+'；聊天经大模型处理，日程由后台校验。':'联网预约系统 · 尚未配置模型密钥。';status('已连接 · 数据保存在门店服务器');render();}catch(e){if(!clientMode&&!key&&e.status===401){status('请输入商家凭证登录');return;}if(accountToken&&e.status===401){leaveAccount();return;}status('连接失败：'+e.message);}}
  if(clientMode){await connect();document.querySelector('#enable-notifications').onclick=async()=>{if(!('Notification'in window))return status('此浏览器不支持系统通知，仍可在网页接收提醒');const p=await Notification.requestPermission();status(p==='granted'?'已开启系统通知；请保持网页在线，关闭网页后仅保留站内提醒':'未开启系统通知，可在网页查看提醒');};}
  else{
   const logout=document.createElement('button');
   logout.type='button';logout.className='secondary';logout.textContent='退出登录';logout.hidden=true;
   logout.onclick=async()=>{
    logout.disabled=true;
    try{await queue;await api('/api/owner/session','DELETE');sessionStorage.removeItem('salon-admin-key');location.reload();}
    catch(error){status('退出失败：'+error.message);logout.disabled=false;}
   };
   box.appendChild(logout);
   const login=document.querySelector('#network-login');
   login.onsubmit=async e=>{
    e.preventDefault();
    key=document.querySelector('#network-key').value.trim();
    if(!key){status('请输入商家凭证登录');return;}
    const button=login.querySelector('button');button.disabled=true;
    try{
     if(document.querySelector('#network-remember').checked){
      await api('/api/owner/session','POST');
      key='';sessionStorage.removeItem('salon-admin-key');
     }
     await connect();
     logout.hidden=!ready;
    }catch(error){status('登录失败：'+error.message);}
    finally{button.disabled=false;}
   };
   await connect();
   logout.hidden=!ready;
  }
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-action="reset"]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();if(clientMode||!ready)return toast('请先登录商家端');if(chatBusy)return toast('请等助手回复完成后再操作');if(!confirm(previewMode?'清空此体验环境中所有客户和商家的聊天、预约、服务历史及提醒？保留客户基本资料、作品与排班设置。':'仅清除本机聊天草稿与缓存，后台预约和聊天记录将保留。继续？'))return;b.disabled=true;try{await waitForSync();const result=previewMode?await api('/api/preview/reset','POST',{revision}):await api('/api/state');epoch++;proposal=null;resetChatDrafts();localStorage.removeItem(KEY);document.querySelectorAll('#network-notices p').forEach(n=>n.remove());install(result);localStorage.setItem(KEY,JSON.stringify(db));toast(previewMode?'聊天、预约、服务历史和提醒已清空':'本机缓存已清除，后台记录保留');}catch(err){toast('未清空：'+err.message);}finally{b.disabled=false;}},true);
  window.SalonNetwork={get ready(){return ready;},get modelEnabled(){return modelEnabled;},get lastError(){return lastError;},clientMode,async reschedule(booking,day,start){await waitForSync();const result=await api('/api/reschedule','POST',{bookingId:booking.id,day,start,expectedDay:booking.day,expectedStart:booking.start});install(result);status('改期已保存，日程已更新');},async saveWork(work){if(clientMode)throw Error('客户只能查看作品');await queue;install(await api('/api/works','PUT',{work}));},async saveWorkContact(data){if(clientMode)throw Error('客户不能修改门店信息');await queue;install(await api('/api/works/contact','PUT',data));},async chat(text,mode,selection){if(!modelEnabled)throw Error('对话暂不可用，请前往「预约」手动登记，输入内容已保留。');if(chatBusy)throw Error('上一条消息正在处理，请稍等');await waitForSync();const customerId=mode==='customer'?getConsult().id:null;chatBusy=true;if(!selection)proposal=null;status('正在等待模型回复…');try{const result=await api('/api/chat','POST',{text,mode,customerId,selection});proposal=result.proposal?{...result.proposal,mode,customerId}:null;install(result);status('模型已回复'+(proposal?'，等待确认执行':''));}catch(e){if(e.networkIssue){e.uncertain=true;lastError=e.message;status('发送结果暂未确认，请恢复连接后先查看聊天记录，输入内容已保留');}else status('模型调用失败：'+e.message);throw e;}finally{chatBusy=false;}},async flush(){await waitForSync();},async invite(customerId,claim=false){await waitForSync();if(!ready||clientMode)throw Error('请先连接商家后台');const result=await api('/api/invites','POST',{customerId,claim});return new URL(result.url,location.href).href;}};
  setInterval(pull,5000);window.addEventListener('focus',pull);
 }
 document.addEventListener('DOMContentLoaded',boot);
})();
