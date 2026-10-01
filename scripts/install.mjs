import {readFile,writeFile,copyFile,mkdir,cp,stat,rename,rm,readdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {cleanNativeBundle,verifyNativeBundle} from './native-bundle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),vault=process.argv[2]&&path.resolve(process.argv[2]);
if(!vault)throw Error('用法：node scripts/install.mjs /Obsidian仓库');
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const plugins=path.join(vault,'.obsidian/plugins'),target=path.join(plugins,manifest.id),config=path.join(vault,'.obsidian/community-plugins.json');
const enabledText=await readFile(config,'utf8'),enabled=JSON.parse(enabledText);
if(!Array.isArray(enabled)||!enabled.every(x=>typeof x==='string'))throw Error('第三方插件启用列表格式无效，未安装');
const native='native/ThoughtSpaceCalendarBridge.app';
async function files(directory,prefix=''){
 const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){
  const relative=prefix+entry.name;if(entry.isDirectory())result.push(...await files(path.join(directory,entry.name),relative+'/'));
  else if(entry.isFile())result.push(relative);else throw Error('发布文件不得含符号链接：'+relative);
 }return result;
}
const runtime=['main.js','styles.css','manifest.json',...(await files(path.join(root,native))).map(name=>native+'/'+name)];
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const expected={};for(const name of runtime)expected[name]=await digest(path.join(root,name));
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup=path.join(vault,'ThoughtSpace-plugin-backups',stamp+'-calendar');
await mkdir(backup,{recursive:true});await writeFile(path.join(backup,'community-plugins.json'),enabledText);
let existing=false;try{existing=(await stat(target)).isDirectory();if(existing)await cp(target,path.join(backup,manifest.id),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(plugins,{recursive:true});const token=randomUUID(),stage=path.join(plugins,'.'+manifest.id+'-stage-'+token),old=target+'-old-'+token;
let promoted=false,oldMoved=false;const temp=config+'.calendar-'+token;
try{
 if(existing)await cp(target,stage,{recursive:true});else await mkdir(stage);
 for(const name of ['main.js','styles.css','manifest.json'])await copyFile(path.join(root,name),path.join(stage,name));
 await rm(path.join(stage,native),{recursive:true,force:true});await mkdir(path.join(stage,'native'),{recursive:true});await cp(path.join(root,native),path.join(stage,native),{recursive:true});
 cleanNativeBundle(path.join(stage,native));verifyNativeBundle(path.join(stage,native));
 for(const name of runtime)if(await digest(path.join(stage,name))!==expected[name])throw Error('安装校验失败：'+name);
 if(await readFile(config,'utf8')!==enabledText)throw Error('启用列表正在更改，请稍后重试');
 if(existing){
  const isUserFile=name=>!['main.js','styles.css','manifest.json'].includes(name)&&!name.startsWith(native+'/');
  const current=(await files(target)).filter(isUserFile).sort(),prepared=(await files(stage)).filter(isUserFile).sort();
  if(JSON.stringify(current)!==JSON.stringify(prepared))throw Error('插件设置文件正在更改，请稍后重试');
  for(const name of current){
   if(await digest(path.join(target,name))!==await digest(path.join(stage,name)))throw Error('插件设置正在更改，请稍后重试：'+name);
  }
 }
 await writeFile(path.join(backup,'installed-SHA256.json'),JSON.stringify(expected,null,2));
 if(existing){
  await rename(target,old);oldMoved=true;
 }
 await rename(stage,target);promoted=true;
 if(!enabled.includes(manifest.id)){
  if(await readFile(config,'utf8')!==enabledText)throw Error('启用列表已被其他操作更改');
  await writeFile(temp,JSON.stringify([...enabled,manifest.id],null,2)+'\n');await rename(temp,config);
 }
 if(oldMoved)await rm(old,{recursive:true,force:true}).catch(error=>console.warn('安装已完成，旧运行目录清理失败：'+String(error)));
 console.log('已安装 '+manifest.version+'：'+target+'\n备份：'+backup+'\n重新加载 ThoughtSpace 日历与日记即可使用大日历。苹果日历需在连接界面授权。');
}catch(error){
 if(promoted)await rm(target,{recursive:true,force:true});if(oldMoved)await rename(old,target);
 throw error;
}finally{await rm(stage,{recursive:true,force:true});await rm(temp,{force:true});}
