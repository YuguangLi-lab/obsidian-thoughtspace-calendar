import type {PlannedTask} from './task-planner-model';
import {inlineCodeRanges,inlineLiteralRanges} from './markdown-literals';
import {dataviewTaskFields,type DataviewTaskKey} from './task-dataview';
import {dateOf} from './calendar-tools';
export type TaskPresentation={title:string;tags:string[];recurrence?:string;blockId?:string};
type Range={from:number;to:number};
const dates=new Set<DataviewTaskKey>(['due','scheduled','completion','start','created','cancelled']);

function escaped(text:string,at:number){let start=at;while(start>0&&text[start-1]==='\\')start--;return (at-start)%2===1;}
function mergeRanges(ranges:Range[]):Range[]{const merged:Range[]=[];for(const r of [...ranges].sort((a,b)=>a.from-b.from)){const last=merged.at(-1);if(last&&r.from<=last.to)last.to=Math.max(last.to,r.to);else merged.push({...r});}return merged;}
function maskRanges(text:string,ranges:Range[]){let at=0,result='';for(const r of mergeRanges(ranges)){result+=text.slice(at,r.from)+'\ufffc'.repeat(r.to-r.from);at=r.to;}return result+text.slice(at);}
/** Pair each delimiter once. Unfinished labels must not rescan the whole remaining task. */
function bracketEnds(text:string){
 const ends=new Map<number,number>(),square:number[]=[],round:number[]=[],wiki:number[]=[];let escape=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];if(char==='\\'){escape=!escape;continue;}
  const literal=escape;escape=false;
  if(char===']'&&text[i+1]===']')wiki.push(i);
  if(literal)continue;
  if(char==='[')square.push(i);else if(char==='(')round.push(i);
  else if(char===']'){const open=square.pop();if(open!==undefined)ends.set(open,i+1);}
  else if(char===')'){const open=round.pop();if(open!==undefined)ends.set(open,i+1);}
 }
 return {ends,wiki};
}

/** Metadata examples inside labels and URL fragments are Markdown, not Tasks fields. */
function linkRanges(text:string):Range[]{
 const prose=maskRanges(text,inlineCodeRanges(text)),ranges:Range[]=[],{ends,wiki}=bracketEnds(prose);let nextWiki=0;
 for(let i=0;i<prose.length;i++){
  if(prose[i]!=='['||escaped(prose,i))continue;
  if(prose.startsWith('[[',i)){while(nextWiki<wiki.length&&wiki[nextWiki]<i+2)nextWiki++;const end=wiki[nextWiki];if(end!==undefined){ranges.push({from:i,to:end+2});i=end+1;}continue;}
  const labelEnd=ends.get(i);if(labelEnd===undefined)continue;
  const next=prose[labelEnd],end=next==='('||next==='['?ends.get(labelEnd):undefined;
  if(end!==undefined){ranges.push({from:i,to:end});i=end-1;}
 }
 for(const m of prose.matchAll(/\b(?:https?:\/\/|obsidian:\/\/|www\.)[^\s<>]+/giu))ranges.push({from:m.index!,to:m.index!+m[0].length});
 return mergeRanges(ranges);
}
function literalRanges(text:string){const links=linkRanges(text),comments=inlineLiteralRanges(maskRanges(text,links)).filter(r=>r.comment);return {protected:mergeRanges([...inlineCodeRanges(text),...links,...comments]),comments};}
function validDate(day:string){try{dateOf(day);return true;}catch{return false;}}

/** Deliberately conservative: unknown recurrence prose stays visible in the title. */
function knownRepeat(value:string){
 const clean=value.toLowerCase();if(!/^every\s+(?:\d+\s+)?(?:day|days|weekday|weekdays|week|weeks|month|months|year|years|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(clean))return false;
 const words=clean.split(/[\s,]+/),known=new Set(['every','day','days','weekday','weekdays','week','weeks','month','months','year','years','on','the','of','and','last','first','second','third','fourth','fifth','when','done','until','for','times','monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december']);
 return words.every(w=>known.has(w)||/^\d+(?:st|nd|rd|th)?$/.test(w)||/^\d{4}-\d{2}-\d{2}$/.test(w));
}
function cleanWhitespace(text:string){let at=0,result='';for(const r of mergeRanges([...inlineCodeRanges(text),...linkRanges(text)])){result+=text.slice(at,r.from).replace(/[ \t]+/g,' ')+text.slice(r.from,r.to);at=r.to;}return (result+text.slice(at).replace(/[ \t]+/g,' ')).trim();}

/** Presentation only; never use this title to write a task back to Markdown. */
export function taskPresentation(task:PlannedTask):TaskPresentation{
 const text=task.text,literals=literalRanges(text),prose=maskRanges(text,literals.protected),remove:Range[]=[...literals.comments],tags:string[]=[];let recurrence:string|undefined,blockId:string|undefined;
 for(const field of dataviewTaskFields(prose)){
  if(dates.has(field.key)&&!validDate(field.value))continue;
  remove.push(field);if(field.key==='repeat'&&!recurrence)recurrence=field.value||'重复';
 }
 for(const m of prose.matchAll(/(?:^|(?<=\s))(?:📅|⏳|✅|🛫|➕|❌)[ \t]*(\d{4}-\d{2}-\d{2})(?=\s|$)/gu))if(validDate(m[1]))remove.push({from:m.index!,to:m.index!+m[0].length});
 for(const m of prose.matchAll(/(?:^|(?<=\s))(?:🔺|⏫|🔼|🔽|⏬)(?=\s|$)/gu))remove.push({from:m.index!,to:m.index!+m[0].length});
 for(const m of prose.matchAll(/(?<![\p{L}\p{N}_/\\])#[\p{L}\p{N}_/-]+/gu)){
  if(!/[\p{L}_-]/u.test(m[0]))continue;
  if(!tags.includes(m[0]))tags.push(m[0]);remove.push({from:m.index!,to:m.index!+m[0].length});
 }
 const reference=prose.match(/(?:^|(?<=\s))\^[A-Za-z0-9-]+[ \t]*$/);if(reference){blockId=reference[0].trim();remove.push({from:reference.index!,to:reference.index!+reference[0].length});}
 const repeats=[...prose.matchAll(/(?:^|(?<=\s))🔁[ \t]+/gu)];
 for(const [i,m] of repeats.entries()){
  const from=m.index!,start=from+m[0].length,end=Math.min(repeats[i+1]?.index??text.length,...remove.filter(r=>r.from>=start).map(r=>r.from)),rule=text.slice(start,end).trim();
  if(!knownRepeat(rule))continue;
  remove.push({from,to:end});recurrence??=rule;
 }
 let at=0,title='';for(const r of mergeRanges(remove)){title+=text.slice(at,r.from)+' ';at=r.to;}title=cleanWhitespace(title+text.slice(at))||'未命名任务';
 return {title,tags,...(recurrence?{recurrence}:{}),...(blockId?{blockId}:{})};
}
