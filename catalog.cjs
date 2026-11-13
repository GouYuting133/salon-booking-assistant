const crypto=require('node:crypto');
function validateWork(w){
 const name=String(w.name||'').trim(),description=String(w.description||'').trim(),image=String(w.image||'');
 if(!name||name.length>60||description.length>1000)throw Error('请填写60字以内的作品名称，介绍不超过1000字');
 if(!['cut','color','perm'].includes(w.category))throw Error('请选择剪发、染发或烫发分类');
 if(image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>1800000))throw Error('作品照片格式或大小不合适，请重新上传');
 if(w.published&&(!image||w.consent!==true))throw Error('发布作品前需要上传照片并确认已有展示授权');
 return {id:w.id||crypto.randomUUID(),name,description,category:w.category,image,published:!!w.published,consent:w.consent===true,updated:Date.now()};
}
function reviewLink(value,type){if(!value)return '';let u;try{u=new URL(value);}catch{throw Error('评价链接格式不正确');}const domains=type==='meituan'?['meituan.com','dianping.com']:['douyin.com','iesdouyin.com'];if(u.protocol!=='https:'||u.username||u.password||!domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw Error('请填写对应美团/大众点评或抖音的 HTTPS 链接');return u.href;}
module.exports={validateWork,reviewLink};
