const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { smallJson } = require('./game-diagnostics.cjs');

async function removeStudioSamples(root) {
 const summary = { removedArtifacts: 0, cleanedConversations: 0 };
 let owners; try { owners = await fs.readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return summary; throw error; }
 for (const owner of owners.filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))) {
  const directory = path.join(root, owner.name), removed = new Set();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
   const file = path.join(directory, entry.name, 'record.json');
   let record; try { record = await smallJson(file); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
   if (record.preview?.mode === 'local-template' || record.preview?.aiUsed === false) { await fs.rm(path.dirname(file), { recursive: true, force: true }); removed.add(entry.name); summary.removedArtifacts++; }
  }
  const conversations = path.join(directory, 'conversations');
  let entries; try { entries = await fs.readdir(conversations); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const name of entries.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
   const file = path.join(conversations, name); let thread;
   try { thread = await smallJson(file); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
   if (thread.mode !== 'preview' && thread.plan?.source !== 'mock' && !thread.messages?.some(message => message.source === 'mock') && !removed.has(thread.artifactId)) continue;
   thread.messages = thread.messages.filter(message => message.role === 'user');
   thread.messages.push({ id: crypto.randomUUID(), role: 'system', content: '旧模拟产物已清理，创作想法已保留，可以通过真实 AI 继续制作。', created: new Date().toISOString() });
   Object.assign(thread, { mode: 'ai', status: 'interrupted', title: thread.messages.find(message => message.role === 'user')?.content.slice(0, 32) || '继续创作', artifactId: null, plan: null, toolchain: null, action: null, error: '', updated: new Date().toISOString() });
   const temporary = file + '.migrate.tmp'; await fs.writeFile(temporary, JSON.stringify(thread)); await fs.rename(temporary, file); summary.cleanedConversations++;
  }
 }
 return summary;
}
module.exports = { removeStudioSamples };
