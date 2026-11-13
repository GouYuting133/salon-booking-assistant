/* Shared transport: tolerate interrupted/HTML gateway replies without leaking browser-specific errors. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SalonHTTP=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function failure(message,code,networkIssue,status){return Object.assign(new Error(message),{code,networkIssue:!!networkIssue,status});}
 async function request(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs||15000);
  try{
   const fetcher=options.fetchImpl||globalThis.fetch;
   const response=await fetcher(url,{method:options.method||'GET',headers:options.headers,body:options.body,signal:controller.signal,cache:'no-store'});
   const text=await response.text();let value;
   try{value=JSON.parse(text);}catch{const expired=/no tunnel/i.test(text);throw failure(expired?'临时体验网址已失效，请联系我获取最新地址':'连接返回的数据不完整，请重新连接后核对记录','BAD_RESPONSE',true,response.status);}
   if(!response.ok)throw failure(value?.error||'后台暂时无法处理请求（'+response.status+'）','HTTP_ERROR',response.status>=500,response.status);
   if(!value||typeof value!=='object')throw failure('后台返回的数据不完整，请重新连接','BAD_RESPONSE',true,response.status);
   return value;
  }catch(err){if(err.code==='BAD_RESPONSE'||err.code==='HTTP_ERROR')throw err;if(controller.signal.aborted)throw failure('连接超时，请重新连接后核对记录','TIMEOUT',true);throw failure('网络连接暂时不可用，请重新连接后重试','NETWORK',true);}
  finally{clearTimeout(timer);}
 }
 return {request};
});
