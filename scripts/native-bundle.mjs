import {execFileSync} from 'node:child_process';
// Finder/iCloud can decorate generated .app bundles with hidden flags and resource forks.
// These are not signed payload. Do not touch quarantine or other security attributes.
export function cleanNativeBundle(app){
 if(process.platform!=='darwin')return;
 execFileSync('/usr/bin/chflags',['-R','nohidden',app]);
 for(const name of ['com.apple.FinderInfo','com.apple.ResourceFork'])execFileSync('/usr/bin/xattr',['-dr',name,app]);
}
export function verifyNativeBundle(app){
 if(process.platform==='darwin')execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);
}
