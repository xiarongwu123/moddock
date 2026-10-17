const fs = require('node:fs/promises');
const path = require('node:path');
const { selectSkills, readSkillFile, verifySkillSources } = require('../studio-skills.cjs');
(async () => {
 const root = path.resolve(__dirname, '..');
 const { loadSkillsFromDir } = await import('../platform/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
 const count = await verifySkillSources();
 await require('../studio-game-api.cjs').verify();
 for (const [name, engine] of [['Unknown', 'unknown'], ['Unity', 'unity'], ['Unity Mono', 'unity-mono'], ['Unity IL2CPP', 'unity-il2cpp'], ['Unreal', 'unreal'], ['Ready or Not', 'unreal'], ['Bethesda', 'creation'], ['Minecraft', 'java'], ['Civilization VII', 'native'], ['Crusader Kings III', 'native'], ['Stardew Valley', 'dotnet'], ['Baldurs Gate 3', 'native'], ['Terraria', 'dotnet']]) {
  const selection = selectSkills({ name }, { engine: { key: engine } });
  for (const skill of selection.skills) {
   await readSkillFile(skill.path);
   if (loadSkillsFromDir({ dir: path.join(root, path.dirname(skill.path)), source: 'moddock' }).skills.length !== 1) throw new Error('Invalid Pi skill: ' + skill.id);
  }
  for (const reference of selection.references) await readSkillFile(reference.path);
 }
 console.log(JSON.stringify({ harness: 'pi-agent', version: '1.3.0', verifiedSourceFiles: count, routesChecked: 13, gameApiVerified: true, modelCalled: false }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
