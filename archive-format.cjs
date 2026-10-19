const fs=require('node:fs/promises');
const {createWriteStream}=require('node:fs');
const path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const {crc32}=require('node:zlib');
const {LIMITS,assertSize,checkArchiveEntry}=require('./archive-limits.cjs');
async function archiveFormat(file){
 const handle=await fs.open(file,'r'),head=Buffer.alloc(1024);let size;
 try{size=(await handle.read(head,0,head.length,0)).bytesRead;}finally{await handle.close();}
 if(head.subarray(0,6).equals(Buffer.from('377abcaf271c','hex')))return '7z';
 if(size>=4&&head[0]===0x50&&head[1]===0x4b&&[0x0403,0x0605,0x0807,0x0606].includes(head.readUInt16LE(2)))return 'zip';
 if(head.subarray(0,6).equals(Buffer.from('526172211a07','hex')))return 'rar';
 if(head.subarray(0,2).equals(Buffer.from('1f8b','hex')))return 'gzip';
 if(/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(head.subarray(0,size).toString('utf8').replace(/^\uFEFF/,'')))return 'html';
 return 'unknown';
}
function formatError(format){return new Error(format==='html'?'下载内容实际是网页，没有取得模组安装包，请重新获取下载':format==='rar'?'文件内容实际是 RAR，当前需要对应解包适配；改成 .zip 后缀无法转换格式':format==='gzip'?'文件内容实际是 gzip，当前需要对应解包适配':'文件内容不是可识别的 ZIP 或 7z 压缩包，可能下载不完整或来源返回了其他内容');}
function binary(){return path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/,'app.asar.unpacked'),'vendor','archive-tools','7za.exe');}
function parseListing(output,archiveBytes,validate){
 const entries=[],seen=new Set();let expanded=0;
 for(const block of output.replace(/\r/g,'').trim().split(/\n\n+/)){
  if(!block.trim())continue;const row={};
  for(const line of block.split('\n')){const i=line.indexOf(' = ');if(i<1)throw new Error('7z 文件清单包含无法识别的字段');const k=line.slice(0,i);if(Object.hasOwn(row,k))throw new Error('7z 文件清单存在重复字段');row[k]=line.slice(i+3);}
  if(!Object.hasOwn(row,'Path'))throw new Error('7z 文件清单缺少路径');
  if(row.Encrypted==='+'||row['Symbolic Link']||row['Hard Link']||row['Alternate Stream']==='+'||/\b(?:l[rwx-]{9}|[BCPLS])\b/.test(row.Attributes||''))throw new Error('7z 包含加密、链接或特殊文件，不能自动解压');
  const directory=row.Folder==='+'||/^D(?:\s|$)/.test(row.Attributes||'');
  const source=validate(row.Path.replace(/\\/g,'/').replace(/\/$/,'')),key=source.normalize('NFC').toLowerCase();
  if(seen.has(key))throw new Error('压缩包存在重名文件：'+source);seen.add(key);
  if(!/^\d+$/.test(row.Size||''))throw new Error('7z 文件大小无效');const size=Number(row.Size);
  if(!Number.isSafeInteger(size))throw new Error('7z 文件大小超出可验证范围');
  const packed=/^\d+$/.test(row['Packed Size']||'')&&Number(row['Packed Size'])>0?Number(row['Packed Size']):archiveBytes;
  if(!directory)expanded+=size;
  checkArchiveEntry({fileName:source+(directory?'/':''),uncompressedSize:size,compressedSize:packed},expanded,entries.length+1);
  if(row.CRC&&!/^[a-f0-9]{8}$/i.test(row.CRC))throw new Error('7z CRC 信息无效');
  entries.push({source,raw:row.Path,size,directory,crc:row.CRC||null});
 }
 if(expanded>LIMITS.ratioMinBytes&&expanded/Math.max(1,archiveBytes)>LIMITS.expansionRatio)throw new Error('7z 累计文件膨胀倍数超过限制');
 if(!entries.some(e=>!e.directory))throw new Error('压缩包没有可安装文件');
 return entries;
}
async function extract7z(file,dir,progress,{relative,target}){
 if(process.platform!=='win32')throw new Error('7z 解压组件当前提供 Windows 版本');
 const exe=binary();await fs.access(exe).catch(()=>{throw new Error('缺少随应用提供的 7z 解压组件，请更新客户端');});
 const archiveBytes=(await fs.stat(file)).size;assertSize(archiveBytes,LIMITS.downloadBytes,'安装包体积',file);
 let stdout;
 try{({stdout}=await promisify(execFile)(exe,['l','-t7z','-slt','-ba','-sccUTF-8','-pModdockNoEncryptedArchives','--',file],{windowsHide:true,timeout:120000,maxBuffer:64*1024**2}));}
 catch{throw new Error('7z 压缩包无法读取，可能不完整、已损坏或使用了密码加密');}
 const entries=parseListing(stdout,archiveBytes,relative),files=[];await fs.mkdir(dir,{recursive:true});
 for(let i=0;i<entries.length;i++){
  const entry=entries[i];if(entry.directory){progress(i+1,entries.length,entry.source);continue;}
  const out=await target(dir,entry.source);await fs.mkdir(path.dirname(out),{recursive:true});
  const child=spawn(exe,['x','-t7z','-so','-y','-bd','-bso0','-bse2','-bsp0','-spd','-ssc','-pModdockNoEncryptedArchives','--',file,entry.raw],{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:300000});
  let bytes=0,crc=0,stderr=0;const hash=crypto.createHash('sha256');child.stderr.on('data',chunk=>{stderr+=chunk.length;if(stderr>65536)child.kill();});
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('7z 文件解压或 CRC 校验失败：'+entry.source)));});
  const meter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>entry.size)return done(new Error('7z 实际解压大小超出清单：'+entry.source));crc=crc32(chunk,crc);hash.update(chunk);progress(i+(entry.size?bytes/entry.size:1),entries.length,entry.source);done(null,chunk);}});
  try{await Promise.all([completion,pipeline(child.stdout,meter,createWriteStream(out,{flags:'wx'})).catch(error=>{child.kill();throw error;})]);}
  catch(error){child.kill();await fs.rm(out,{force:true});throw error;}
  if(bytes!==entry.size||entry.crc&&crc.toString(16).padStart(8,'0').toUpperCase()!==entry.crc.toUpperCase())throw new Error('7z 文件大小或 CRC 校验不匹配：'+entry.source);
  files.push({source:entry.source,size:bytes,sha256:hash.digest('hex')});progress(i+1,entries.length,entry.source);
 }
 return files;
}
module.exports={archiveFormat,formatError,extract7z,parseListing,binary};
