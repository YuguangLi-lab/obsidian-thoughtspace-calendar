// Package the current runtime in a local staging directory, away from iCloud metadata changes.
import {readFile,writeFile,mkdir,readdir,stat,mkdtemp,copyFile,cp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanNativeBundle,verifyNativeBundle} from './native-bundle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8')).version;
async function files(directory,prefix=''){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.isDirectory())result.push(...await files(path.join(directory,entry.name),prefix+entry.name+'/'));else if(entry.isFile())result.push(prefix+entry.name);else throw Error('发布文件不应包含符号链接');}return result;}
const native='native/ThoughtSpaceCalendarBridge.app';
const documents=['main.js','styles.css','manifest.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md',`FEATURES-${version}.md`,`docs/RELEASE-${version}.md`,`qa/RELEASE-VERIFY-${version}.json`,`qa/UPSTREAM-TASKS-${version}.json`,'README.en.md','docs/USAGE.md','docs/APPLE-CALENDAR.md','docs/DEVELOPMENT.md','docs/TESTING.md','docs/images/month.png','docs/images/week.png','docs/images/narrow.png','docs/images/tasks.png','docs/images/quadrants.png','docs/images/timeline.png'];
const names=[...documents,...(await files(path.join(root,native))).map(name=>native+'/'+name)];
const stage=await mkdtemp(path.join(os.tmpdir(),'thoughtspace-calendar-release-'));
try{
 for(const name of documents){await mkdir(path.dirname(path.join(stage,name)),{recursive:true});await copyFile(path.join(root,name),path.join(stage,name));}
 await mkdir(path.join(stage,'native'));await cp(path.join(root,native),path.join(stage,native),{recursive:true});
 cleanNativeBundle(path.join(stage,native));verifyNativeBundle(path.join(stage,native));
 const hashes={};for(const name of names){const bytes=await readFile(path.join(stage,name));hashes[name]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}
 const release=path.join(root,'release');await mkdir(release,{recursive:true});const archive=`thoughtspace-calendar-${version}.zip`,target=path.join(release,archive);
 // ZipFile.write records Unix mode bits, including the helper's executable bit; no Finder xattrs.
 execFileSync('python3',['-c','import sys,json,zipfile,pathlib; root=pathlib.Path(sys.argv[1]); names=json.loads(sys.argv[3]); z=zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9); [z.write(root/n,n) for n in names]; z.close()',stage,target,JSON.stringify(names)]);
 const archiveBytes=await readFile(target);hashes[archive]={sha256:createHash('sha256').update(archiveBytes).digest('hex'),bytes:archiveBytes.length};
 await writeFile(path.join(release,`SHA256-${version}.json`),JSON.stringify(hashes,null,2)+'\n');
 await writeFile(path.join(release,`FILES-${version}.txt`),Object.entries(hashes).map(([name,value])=>`${value.sha256} ${String(value.bytes).padStart(10)}  ${name}`).join('\n')+'\n');
 console.log(target+'\n'+archiveBytes.length+' bytes; native executable '+((await stat(path.join(stage,native,'Contents/MacOS/calendar-bridge'))).mode&0o777).toString(8));
}finally{await rm(stage,{recursive:true,force:true});}
