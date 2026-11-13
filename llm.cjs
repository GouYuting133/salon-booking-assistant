const fs=require('node:fs'),path=require('node:path');
function config(){
 const values={};if(process.env.SALON_LLM_DISABLED==='1')return {enabled:false};
 const file=path.join(__dirname,'.env');if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=/^([A-Z_]+)\s*=\s*(.*)$/.exec(line);if(m)values[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}
 const key=process.env.DASHSCOPE_API_KEY||values.DASHSCOPE_API_KEY||'',model=process.env.SALON_MODEL||values.SALON_MODEL||'qwen-plus',base=process.env.SALON_MODEL_BASE_URL||values.SALON_MODEL_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1';
 return {enabled:!!key,key,model,base};
}
async function infer(messages){
 const c=config();if(!c.enabled)throw Error('尚未配置模型密钥');
 const url=new URL(c.base.replace(/\/$/,'')+'/chat/completions');if(url.protocol!=='https:'||!/(^|\.)aliyuncs\.com$/.test(url.hostname))throw Error('模型地址必须是阿里云官方 HTTPS 地址');
 let r;try{r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,messages,enable_thinking:false,response_format:{type:'json_object'},temperature:0.2,max_tokens:1200}),signal:AbortSignal.timeout(45000),redirect:'error'});}catch{throw Error('连接模型超时或网络不可用，请重试');}
 if(!r.ok){const errors={401:'模型密钥无效或地域不匹配',403:'模型权限不足，请检查是否授权 qwen-plus',429:'模型调用过于频繁或额度不足，请检查百炼控制台',402:'模型账户余额不足'};throw Error(errors[r.status]||'模型调用失败（HTTP '+r.status+'），请检查模型权限和账户额度');}
 const data=await r.json();let value;try{value=JSON.parse(data.choices?.[0]?.message?.content);}catch{throw Error('模型回复格式异常，本次未修改日程');}
 if(typeof value.reply!=='string'||value.reply.length>6000)throw Error('模型回复不完整，本次未修改日程');return value;
}
module.exports={config,infer};
