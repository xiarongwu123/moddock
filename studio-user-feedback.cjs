const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function confirmed(item) {
 return !!item.toolchain?.id && item.feedback?.status === 'accepted' && item.feedback.buildId === item.toolchain.id;
}
async function recordFeedback(studio, owner, game, input, current) {
 if (!current()) throw new Error('账号已切换');
 const item = await studio.read(owner, input.artifactId);
 if (item.gameId !== game.id) throw new Error('创作不属于当前游戏');
 if (!input.buildId || item.toolchain?.id !== input.buildId || item.toolchain.status !== 'passed' || !item.installable) throw new Error('作品版本已变化或尚未通过制作检查，请刷新后再反馈');
 if (!['accepted', 'rejected'].includes(input.status)) throw new Error('请选择是否能正常使用');
 const problem = String(input.problem || '').trim();
 if (input.status === 'rejected' && (!problem || problem.length > 2000)) throw new Error('请描述遇到的问题，最多 2000 字');
 const feedback = { status: input.status, artifactId: item.id, buildId: input.buildId, problem: input.status === 'rejected' ? problem : '', created: new Date().toISOString() };
 const file = path.join(studio.recordPath(owner, item.id), 'feedback.json'), temporary = file + '.' + crypto.randomUUID() + '.tmp';
 try {
  await fs.writeFile(temporary, JSON.stringify(feedback), { flag: 'wx' });
  if (!current()) throw new Error('账号已切换');
  await fs.rename(temporary, file);
 } finally { await fs.rm(temporary, {force:true}); }
 return feedback;
}
module.exports = { confirmed, recordFeedback };
