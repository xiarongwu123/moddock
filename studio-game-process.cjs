const path=require('node:path');
const {spawn}=require('node:child_process');
const {processes}=require('./installers.cjs');

async function observePlatformProcess(installers,game,run) {
 if(run.launchMethod!=='platform' || run.exited) return;
 installers.platformMonitors ||= new Map();
 if(installers.platformMonitors.has(run.id)) return;
 if(run.processProbeAt && Date.now()-run.processProbeAt<2500) return;
 run.processProbeAt=Date.now();
 const root=path.resolve(game.installPath).toLowerCase()+path.sep;
 const rows=await (installers.options.processes || processes)();
 const candidates=rows.filter(p=>p.pid!==process.pid && Number.isSafeInteger(p.pid) && p.pid>0 && p.path && path.resolve(p.path).toLowerCase().startsWith(root) && !/crash|report|unins|redist|launcher/i.test(p.name || path.basename(p.path)));
 candidates.sort((a,b)=>Number(/shipping/i.test(b.path))-Number(/shipping/i.test(a.path)) || b.path.length-a.path.length);
 const candidate=candidates[0];if(!candidate)return;
 run.gamePid=candidate.pid;run.gameExecutable=candidate.path;run.processObserved=new Date().toISOString();
 if(process.platform!=='win32') return;
 // Hold an OS process handle before exit, including Steam/Epic-launched games.
 // The helper watches only: closing it never terminates the game.
 const script=`$ErrorActionPreference='Stop'; try { $observed=[System.Diagnostics.Process]::GetProcessById(${candidate.pid}); [void]$observed.Handle; $observed.WaitForExit(); @{exitCode=$observed.ExitCode}|ConvertTo-Json -Compress } catch { @{error=$_.Exception.Message}|ConvertTo-Json -Compress; exit 1 }`;
 const child=(installers.options.platformMonitorSpawn || spawn)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
 const entry={child,stopped:false};installers.platformMonitors.set(run.id,entry);
 let output='';child.stdout.on('data',b=>{if(output.length<4096)output+=b.toString();});
 child.stderr.on('data',()=>{});
 child.once('error',error=>{run.processObservationError=error.message;installers.platformMonitors.delete(run.id);});
 child.once('close',code=>{
  installers.platformMonitors.delete(run.id);if(entry.stopped)return;
  try {
   const result=JSON.parse(output.trim());
   if(code===0 && Number.isInteger(result.exitCode)) {run.exitCode=result.exitCode;run.exited=new Date().toISOString();}
   else run.processObservationError=String(result.error || '无法取得游戏退出码').slice(0,500);
  } catch {run.processObservationError='游戏进程观察未返回有效结果';}
 });
}
function stopPlatformMonitors(installers) {
 for(const entry of installers.platformMonitors?.values() || []){entry.stopped=true;entry.child.kill();}
 installers.platformMonitors?.clear();
}
module.exports={observePlatformProcess,stopPlatformMonitors};
