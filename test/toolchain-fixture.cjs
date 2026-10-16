// Synthetic game APIs for compiler integration tests; never ship as game references.
const fs = require('node:fs/promises');
const path = require('node:path');
const { StudioTools, runTool } = require('../studio-tools.cjs');

async function monoFixture(root) {
 const { csharp } = await new StudioTools().probe();
 if (!csharp.available) throw new Error('Compiler integration fixture requires a .NET SDK');
 const sdkRoot = path.resolve(path.dirname(csharp.compiler), '../../../..');
 const pack = path.join(sdkRoot, 'packs/Microsoft.NETCore.App.Ref');
 const version = (await fs.readdir(pack)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
 const frameworks = path.join(pack, version, 'ref');
 const referenceRoot = path.join(frameworks, (await fs.readdir(frameworks)).at(-1));
 const managed = path.join(root, 'Game_Data/Managed'), core = path.join(root, 'BepInEx/core'), work = path.join(root, 'fixture-build');
 await Promise.all([fs.mkdir(managed, { recursive: true }), fs.mkdir(core, { recursive: true }), fs.mkdir(work, { recursive: true })]);
 const names = (await fs.readdir(referenceRoot)).filter(name => name.endsWith('.dll'));
 await Promise.all(names.map(name => fs.copyFile(path.join(referenceRoot, name), path.join(managed, name))));
 const references = names.map(name => '/reference:' + path.join(managed, name));
 const compile = async (name, code, output, additional = []) => {
  const source = path.join(work, name + '.cs'); await fs.writeFile(source, code);
  const result = await runTool(csharp.executable, [csharp.compiler, '/nologo', '/noconfig', '/nostdlib+', '/target:library', '/out:' + output, ...references, ...additional.map(file => '/reference:' + file), source], { cwd: work });
  if (result.code !== 0) throw new Error(result.output);
 };
 const unity = path.join(managed, 'UnityEngine.dll');
 await compile('Unity', `namespace UnityEngine {
 public enum HideFlags { HideAndDontSave = 61 }
 public class Object { public HideFlags hideFlags {get;set;} public static void DontDestroyOnLoad(Object target) {} }
 public class Component : Object {}
 public class Behaviour : Component {}
 public class MonoBehaviour : Behaviour {}
 public class GameObject : Object { public GameObject(string name) {} public T AddComponent<T>() where T : Component { return default(T); } }
 public static class Application { public static int targetFrameRate {get;set;} }
 public static class Time { public static int frameCount {get;set;} }
 }`, unity);
 await compile('Game', 'public class FixtureGame {}', path.join(managed, 'Assembly-CSharp.dll'));
 await compile('BepInEx', `namespace BepInEx {
 [System.AttributeUsage(System.AttributeTargets.Class)] public class BepInPlugin : System.Attribute { public BepInPlugin(string id,string name,string version) {} }
 public class BaseUnityPlugin : UnityEngine.MonoBehaviour { protected Configuration.ConfigFile Config = new Configuration.ConfigFile(); protected Log Logger = new Log(); }
 public class Log { public void LogInfo(object value) {} }
 } namespace BepInEx.Configuration {
 public class ConfigEntry<T> { public T Value {get;set;} }
 public class ConfigFile { public ConfigEntry<T> Bind<T>(string section,string key,T value,string description) { return new ConfigEntry<T> { Value=value }; } }
 }`, path.join(core, 'BepInEx.dll'), [unity]);
 await fs.rm(work, { recursive: true, force: true });
 return { compiler: csharp.version, referenceCount: names.length };
}
module.exports = { monoFixture };
