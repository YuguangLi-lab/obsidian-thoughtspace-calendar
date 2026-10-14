import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveTaskRowFocus} from '../src/ui-focus';

/** A focused DOM seam: selectors, connectivity and focus match browser behavior. */
function host() {
 const doc:any={body:{},activeElement:null};doc.activeElement=doc.body;
 let rows:any[]=[];
 const root:any={ownerDocument:doc,contains:(row:any)=>rows.includes(row),querySelectorAll:()=>rows,querySelector:()=>undefined};
 const make=(line:number,source:string,label='完成任务：'+source)=>{
  const row:any={dataset:{path:'Tasks.md',line:String(line),source}};
  const input:any={isConnected:true,disabled:false,getAttribute:(name:string)=>name==='aria-label'?label:null,matches:(selector:string)=>selector==='input[type=checkbox]',closest:()=>row,getClientRects:()=>[{}],focus:()=>doc.activeElement=input};
  row.querySelector=()=>input;row.querySelectorAll=()=>[input];row.input=input;return row;
 };
 return {root,doc,make,replace:(next:any[])=>{for(const row of rows)row.input.isConnected=false;rows=next;doc.activeElement=doc.body;},initial:(next:any[])=>rows=next};
}
test('row focus follows its exact source when a preceding recurrence inserts a line',()=>{
 const h=host(),first=h.make(0,'- [ ] A 🔁 every day'),second=h.make(1,'- [ ] B');h.initial([first,second]);second.input.focus();
 const restore=preserveTaskRowFocus(h.root),nextA=h.make(0,first.dataset.source),completed=h.make(1,'- [x] A 🔁 every day'),nextB=h.make(2,second.dataset.source);
 h.replace([nextA,completed,nextB]);restore();assert.equal(h.doc.activeElement,nextB.input);
});
test('a removed task advances to the next visible task without stealing editor focus',()=>{
 const h=host(),a=h.make(0,'A'),b=h.make(1,'B');h.initial([a,b]);a.input.focus();const restore=preserveTaskRowFocus(h.root);
 const nextB=h.make(1,'B');h.replace([nextB]);restore();assert.equal(h.doc.activeElement,nextB.input);
 nextB.input.focus();const noSteal=preserveTaskRowFocus(h.root);h.replace([h.make(1,'B')]);const editor={};h.doc.activeElement=editor;noSteal();assert.equal(h.doc.activeElement,editor);
});
test('same title with different dates retains source identity after line insertion',()=>{
 const h=host(),a=h.make(2,'- [ ] 同名 📅 2026-10-11'),b=h.make(3,'- [ ] 同名 📅 2026-10-12');h.initial([a,b]);b.input.focus();const restore=preserveTaskRowFocus(h.root);
 const shiftedA=h.make(3,a.dataset.source),shiftedB=h.make(4,b.dataset.source);h.replace([shiftedA,shiftedB]);restore();assert.equal(h.doc.activeElement,shiftedB.input);
});
test('identical undated recurrences preserve their source occurrence when another completes',()=>{
 const h=host(),source='- [ ] Daily 🔁 every day',a=h.make(0,source),b=h.make(1,source);h.initial([a,b]);b.input.focus();const restore=preserveTaskRowFocus(h.root);
 const nextA=h.make(0,source),completed=h.make(1,source.replace('[ ]','[x]')),nextB=h.make(2,source);h.replace([nextA,completed,nextB]);restore();assert.equal(h.doc.activeElement,nextB.input);
});
test('a generated recurrence never captures the focused task with the same next date',()=>{
 const h=host(),sourceA='- [ ] Read 🔁 every day 📅 2026-10-11',sourceB='- [ ] Read 🔁 every day 📅 2026-10-12',a=h.make(0,sourceA),b=h.make(1,sourceB);a.dataset.focusKey='a';b.dataset.focusKey='b';h.initial([a,b]);b.input.focus();const restore=preserveTaskRowFocus(h.root);
 const generated=h.make(0,sourceB),completed=h.make(1,sourceA.replace('[ ]','[x]')),sameB=h.make(2,sourceB);generated.dataset.focusKey='next-a';completed.dataset.focusKey='done-a';sameB.dataset.focusKey='b';h.replace([generated,completed,sameB]);restore();assert.equal(h.doc.activeElement,sameB.input);
});
