import {maskInlineLiterals} from './markdown-literals';

export type DataviewTaskKey='due'|'scheduled'|'completion'|'priority'|'repeat'|'start'|'created'|'cancelled'|'onCompletion'|'id'|'dependsOn';
export interface DataviewTaskField {from:number;to:number;key:DataviewTaskKey;value:string;open:'['|'(';prefix:string;suffix:string}
const keys='due|scheduled|completion|priority|repeat|start|created|cancelled|onCompletion|id|dependsOn';
const dateKeys=new Set<DataviewTaskKey>(['due','scheduled','completion','start','created','cancelled']);
function validValue(key:DataviewTaskKey,value:string){
 if(dateKeys.has(key))return /^\d{4}-\d{2}-\d{2}$/.test(value);
 if(key==='priority')return /^(highest|high|medium|low|lowest)$/.test(value);
 // Even an unfinished or invalid rule belongs to Tasks. Treating it as an
 // ordinary checkbox would silently bypass recurrence validation on completion.
 if(key==='repeat')return true;
 if(key==='onCompletion')return /^[a-zA-Z]+$/.test(value);
 return /^[a-zA-Z0-9]+(?:\s*,\s*[a-zA-Z0-9]+)*$/.test(value);
}

/** Tasks' Dataview format accepts paired [] and (), outside code and comments. */
export function dataviewTaskFields(text:string):DataviewTaskField[]{
 if(!text.includes('::'))return [];
 const prose=maskInlineLiterals(text),fields:DataviewTaskField[]=[];
 for(const open of ['[','('] as const){
  const close=open==='['?']':')';
  const pattern=new RegExp(`(\\${open}[ \\t]*(${keys})::[ \\t]*)([^\\[\\]\\(\\)\\r\\n]*?)([ \\t]*\\${close}(?:[ \\t]*,)?)(?![\\[(])`,'g');
  for(const match of prose.matchAll(pattern)){
   const from=match.index!,key=match[2] as DataviewTaskKey,value=match[3].trim();
   let slash=from;while(slash>0&&prose[slash-1]==='\\')slash--;
   // Escaped notation and wiki-links are prose, not task metadata.
   if((from-slash)%2||prose[from-1]==='['||!validValue(key,value))continue;
   fields.push({from,to:from+match[0].length,key,value,open,prefix:match[1],suffix:match[4]});
  }
 }
 return fields.sort((a,b)=>a.from-b.from);
}

/** Replace only the requested inline field, keeping its brackets and spacing. */
export function updateDataviewTaskField(text:string,key:DataviewTaskKey,value:string):{text:string;found:boolean}{
 const fields=dataviewTaskFields(text).filter(field=>field.key===key);let result='',at=0;
 for(let i=0;i<fields.length;i++){
  const field=fields[i],prefix=text.slice(at,field.from);
  result+=value&&i===0?prefix+field.prefix+value+field.suffix:prefix.replace(/[ \t]+$/,'');
  at=field.to;
 }
 return {text:result+text.slice(at),found:fields.length>0};
}

export function dataviewTaskFieldText(key:DataviewTaskKey,value:string,open:'['|'('){return `${open}${key}:: ${value}${open==='['?']':')'}`;}

export function stripDataviewTaskFields(text:string,keys:ReadonlySet<DataviewTaskKey>){
 let result='',at=0;
 for(const field of dataviewTaskFields(text))if(keys.has(field.key)){result+=text.slice(at,field.from).replace(/[ \t]+$/,'');at=field.to;}
 return result+text.slice(at);
}
