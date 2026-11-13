/* Fixed service choices supplied by the shop; no project-management settings. */
(function(root){
 const groups={cut:'基础洗护剪',perm:'烫发系列',color:'染发系列（含漂发）',care:'护理与头皮养护'};
 const rows=[
 ['wash-style','cut','洗吹造型',30,false],['wash-dry','cut','洗吹（湿洗+吹干）',20,false],['cut-men','cut','男士洗剪吹',25,true],['cut-women','cut','女士洗剪吹',45,true],['cut-child','cut','儿童理发',30,true],['cut-only','cut','单剪（不洗）',20,true],['style-once','cut','一次性造型',20,false],
 ['perm-hot','perm','基础热烫',240,false],['perm-cold-long','perm','冷烫长发',180,false],['perm-cold-short','perm','冷烫短发/颅顶蓬松烫',120,false],['perm-straight','perm','拉直/离子烫/蛋白矫正',240,false],['perm-soft','perm','柔顺（顺直、受损发质柔顺）',120,false],['perm-fringe','perm','刘海矫正/服帖烫',60,false],
 ['color-all','color','生活色全头染',100,false],['color-bleach','color','单次漂发',90,false],['color-balayage','color','巴黎画染',420,false],['color-roots','color','发根补染',60,false],['color-highlights','color','挑染、挂耳染',180,false],
 ['care-basic','care','基础水疗、发膜护理',45,false],['care-protein','care','蛋白修复、角蛋白护理',80,false],['care-premium','care','鱼子酱/高端院线护理',100,false]
 ];
 const list=rows.map(([id,category,name,duration,isHaircut])=>Object.freeze({id,category,name,duration,isHaircut}));
 const find=id=>list.find(s=>s.id===id);
 const label=id=>'顾客'+String(id||'').replace(/[^a-zA-Z0-9]/g,'').slice(-6).toUpperCase();
 function ownerContactText(settings){
  return [settings.wechat&&'店主微信：'+settings.wechat,settings.phone&&'店主电话：'+settings.phone].filter(Boolean).join('\n');
 }
 const needsOwnerConfirmation=service=>service?.category==='color'||service?.category==='perm';
 const validContactPhone=phone=>typeof phone==='string'&&/^1[3-9]\d{9}$/.test(phone);
 root.SalonServices={groups,list:Object.freeze(list),find,anonymousLabel:label,ownerContactText,needsOwnerConfirmation,validContactPhone};
 if(typeof module!=='undefined')module.exports=root.SalonServices;
})(globalThis);
