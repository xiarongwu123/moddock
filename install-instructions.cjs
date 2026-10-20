const {instructionTexts}=require('./author-install.cjs');

// A cooked character Blueprint is an ordinary PAK asset. Only concrete tool
// names and installation requirements can establish a loader dependency.
function externalToolEvidence(context){
 const evidence=[];
 for(const {source,text}of instructionTexts(context)){
  for(const sentence of text.split(/[\r\n。！？!?;]+|\.\s+/))for(const clause of sentence.split(/[,，]|\b(?:but|however|whereas|and)\b|但是|但(?:是)?|而(?:且)?/i)){
   const clean=clause.replace(/https?:\/\/\S+/gi,' ');
   const tools=[...clean.matchAll(/\b(?:UE4SS|blueprint[\s_-]*loader|logicmods|texmod|(?:tekken[\s_-]*)?moveset[\s_-]*extractor)\b/gi)];
   for(const match of tools){
    const quote=clause.trim().slice(0,800);
    const negative=/\b(?:not\s+(?:required|needed|necessary)|no\s+need|no\s+(?:UE4SS|blueprint[\s_-]*loader|logicmods|texmod|moveset[\s_-]*extractor)\s+(?:is\s+)?(?:required|needed|necessary)|(?:does|do)\s+not\s+(?:require|need|install|use)|(?:doesn|don)['’]t\s+(?:require|need|install|use)|without\s+(?:requiring|needing))\b|无需|不需要|不依赖|不用安装|不要安装|请勿安装/i.test(clean);
    const optional=/\b(?:optional|recommended|recommendation)\b|可选|推荐/i.test(clean);
    const explicit=/\b(?:requires?|requirements?|needs?|needed|necessary|depends?\s+on|must|mandatory)\b|\b(?:install|use|copy|extract|place|put|drop|move)\b.{0,100}\b(?:UE4SS|blueprint[\s_-]*loader|logicmods|texmod|(?:tekken[\s_-]*)?moveset[\s_-]*extractor)\b|需要|必须|依赖|安装|放入|复制/i.test(clean)||/[\\/]LogicMods(?:[\\/]|$)/i.test(clean)||/\bUE4SS[\s_-]+(?:based|mod)\b/i.test(clean);
    const optionalInstruction=/^\s*(?:optional|recommended|可选|推荐)\s*[:：-]/i.test(clean);
    evidence.push({source,tool:match[0],state:negative||optionalInstruction?'optional':explicit?'required':optional?'optional':'uncertain',quote});
   }
  }
 }
 return evidence;
}
function assertPlainPakInstructions(context){
 const items=externalToolEvidence(context),required=items.find(item=>item.state==='required');
 if(required)throw Object.assign(new Error(`作者明确要求外部工具 ${required.tool}，需要对应加载器的专用安装流程。依据：${required.quote.slice(0,240)}`),{code:'AUTO_INSTALL_UNSUPPORTED'});
 const uncertain=items.find(item=>item.state==='uncertain');
 if(uncertain)throw Object.assign(new Error(`作者说明提及 ${uncertain.tool}，尚未确认它是否是所选文件的安装前置，需要结合说明进一步分析`),{code:'AUTO_INSTALL_INSTRUCTIONS'});
}
module.exports={externalToolEvidence,assertPlainPakInstructions};
