const documents = new Set(['project-plan', 'custom-project']);
function deliverableFor(prompt = '') {
 const text = prompt.trim();
 if (/^(?:请|帮我)?(?:先|只)?(?:给我|要|生成|做|写|整理|输出|提供)(?:一份|一个)?(?:开发|制作|设计)?方案(?:[，。！？\s]|$)/.test(text) || /^(?:only\s+)?(?:write|give me|create)\s+(?:a\s+)?(?:development\s+)?plan\b/i.test(text) || /^make the plan\b/i.test(text)) return 'plan';
 if (/^(?:请)?只(?:给我|要|输出|生成)(?:完整)?源码/.test(text)) return 'source';
 return 'mod';
}
module.exports = { deliverableFor, documents };
