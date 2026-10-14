import test from 'node:test';
import assert from 'node:assert/strict';
import {draggedTimeRange,mountTimeRangePicker,parseTimeMinute,timeRangeMinute} from '../src/time-range-selection';

test('time rail maps actual geometry to quarter-hour positions without exceeding the day',()=>{
 assert.equal(timeRangeMinute(160,10,240),900);assert.equal(timeRangeMinute(-99,10,240),0);assert.equal(timeRangeMinute(400,10,240),1440);
 assert.throws(()=>timeRangeMinute(10,0,0),/时间/);assert.throws(()=>timeRangeMinute(NaN,0,200),/时间/);
});
test('range selection handles forward and reversed drags and click creates thirty minutes',()=>{
 assert.deepEqual(draggedTimeRange(540,660),{start:540,end:660});assert.deepEqual(draggedTimeRange(660,540),{start:540,end:660});
 assert.deepEqual(draggedTimeRange(600,600),{start:600,end:630});
});
test('right-edge selections fit native time input instead of writing an invalid 24:00',()=>{
 assert.deepEqual(draggedTimeRange(1380,1440),{start:1380,end:1439});assert.deepEqual(draggedTimeRange(1440,1440),{start:1425,end:1439});
 assert.throws(()=>draggedTimeRange(Infinity,20),/时间/);
});
test('manual time inputs keep their exact minutes and reject invalid values',()=>{
 assert.equal(parseTimeMinute('09:07'),547);assert.equal(parseTimeMinute('23:59'),1439);assert.equal(parseTimeMinute('00:00'),0);
 for(const value of ['', '24:00','09:60','9:07','wrong'])assert.equal(parseTimeMinute(value),undefined);
});

class ElementStub extends EventTarget {
 children:ElementStub[]=[];parent?:ElementStub;style:any={};dataset:any={};className='';textContent='';hidden=false;disabled=false;value='';type='';removed=false;attrs=new Map<string,string>();
 classList={add:(_name:string)=>{},remove:(_name:string)=>{}};
 constructor(public ownerDocument:any){super();}
 append(...children:ElementStub[]){for(const child of children){child.parent=this;this.children.push(child);}}
 setAttribute(name:string,value:string){this.attrs.set(name,value);}
 getBoundingClientRect(){return {left:0,width:240};}
 closest(selector:string){return this.className===selector.slice(1)?this:null;}
 remove(){this.removed=true;}
}
function control(startValue='09:07',endValue='10:08',bindEscape?:(cancel:()=>void)=>()=>void){
 const win:any=new EventTarget();win.Event=Event;const document:any={defaultView:win,createEvent:()=>{const event:any=new Event('input',{bubbles:true});event.initEvent=()=>{};return event;}};document.createElement=()=>new ElementStub(document);
 const parent=new ElementStub(document),start=new ElementStub(document),end=new ElementStub(document);start.value=startValue;end.value=endValue;
 const picker=mountTimeRangePicker(parent as any,start as any,end as any,bindEscape),root=parent.children[0],track=root.children[1];
 const pointer=(type:string,x:number,id=1)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{button:0,pointerId:id,clientX:x});return e;};
 return {picker,root,track,start,end,win,pointer,document};
}
test('gesture previews do not mutate inputs before release and pointer cancel restores exact minutes',()=>{
 const h=control();h.track.dispatchEvent(h.pointer('pointerdown',120));h.win.dispatchEvent(h.pointer('pointermove',150));assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');
 h.win.dispatchEvent(h.pointer('pointercancel',150));h.win.dispatchEvent(h.pointer('pointerup',150));assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');h.picker.destroy();
});
test('pointer release commits once and Escape cancels only the active gesture',()=>{
 const h=control();let inputs=0;h.start.addEventListener('input',()=>inputs++);h.track.dispatchEvent(h.pointer('pointerdown',90));h.win.dispatchEvent(h.pointer('pointermove',100));
 const escape=new Event('keydown',{cancelable:true});Object.assign(escape,{key:'Escape'});h.win.dispatchEvent(escape);assert.equal(escape.defaultPrevented,true);assert.equal(h.start.value,'09:07');assert.equal(inputs,0);
 h.track.dispatchEvent(h.pointer('pointerdown',90));h.win.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.start.value,'09:00');assert.equal(h.end.value,'10:00');assert.equal(inputs,1);h.picker.destroy();
});
test('manual inputs and preset refresh retain exact minutes and destroying a gesture removes listeners',()=>{
 const h=control();h.start.value='11:13';h.end.value='12:29';h.start.dispatchEvent(new Event('input'));h.picker.refresh();assert.equal(h.start.value,'11:13');assert.equal(h.end.value,'12:29');
 h.track.dispatchEvent(h.pointer('pointerdown',60));h.picker.destroy();h.win.dispatchEvent(h.pointer('pointerup',80));assert.equal(h.start.value,'11:13');assert.equal(h.end.value,'12:29');assert.equal(h.root.removed,true);
});
test('disabled inputs cannot begin a range gesture',()=>{
 const h=control();h.start.disabled=true;h.track.dispatchEvent(h.pointer('pointerdown',60));h.win.dispatchEvent(h.pointer('pointerup',80));assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');h.picker.destroy();
});
test('native Escape scope exists only during selection and closes on cancel, commit and destroy',()=>{
 let callback:(()=>void)|undefined,pushed=0,released=0;
 const h=control('09:07','10:08',cancel=>{callback=cancel;pushed++;return ()=>released++;});
 h.track.dispatchEvent(h.pointer('pointerdown',120));callback!();assert.equal(h.start.value,'09:07');assert.equal(released,1);
 h.track.dispatchEvent(h.pointer('pointerdown',120));h.win.dispatchEvent(h.pointer('pointerup',150));assert.equal(released,2);
 h.track.dispatchEvent(h.pointer('pointerdown',60));h.picker.destroy();h.picker.destroy();assert.equal(pushed,3);assert.equal(released,3);
});
test('unrelated pointers cannot cancel or start a second time selection',()=>{
 const h=control();h.track.dispatchEvent(h.pointer('pointerdown',90));h.win.dispatchEvent(h.pointer('pointermove',100));
 h.win.dispatchEvent(h.pointer('pointercancel',100,2));h.win.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.end.value,'10:00');
 const secondary=h.pointer('pointerdown',120);Object.assign(secondary,{isPrimary:false});h.track.dispatchEvent(secondary);h.win.dispatchEvent(h.pointer('pointerup',160));assert.equal(h.end.value,'10:00');h.picker.destroy();
});
test('a collapsed or removed time rail cancels release and restores the modal Escape scope',()=>{
 let released=0;const h=control('09:07','10:08',()=>()=>released++);
 h.track.dispatchEvent(h.pointer('pointerdown',90));h.win.dispatchEvent(h.pointer('pointermove',100));
 h.track.getBoundingClientRect=()=>({left:0,width:0});assert.doesNotThrow(()=>h.win.dispatchEvent(h.pointer('pointerup',100)));
 assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');assert.equal(released,1);
 h.win.dispatchEvent(h.pointer('pointerup',150));assert.equal(h.start.value,'09:07');h.picker.destroy();assert.equal(released,1);
});
test('fifty gestures after moving the control to another window commit in the owning window only',()=>{
 const h=control(),next:any=new EventTarget();next.Event=Event;const nextDocument={...h.document,defaultView:next};h.track.ownerDocument=nextDocument;h.root.ownerDocument=nextDocument;h.start.ownerDocument=nextDocument;h.end.ownerDocument=nextDocument;
 for(let i=0;i<50;i++){
  h.start.value='09:07';h.end.value='10:08';h.picker.refresh();h.track.dispatchEvent(h.pointer('pointerdown',90));
  h.win.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.start.value,'09:07');next.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.start.value,'09:00');assert.equal(h.end.value,'10:00');
 }
 h.picker.destroy();
});
test('moving windows midway cancels the captured gesture without changing precise inputs',()=>{
 let released=0;const h=control('09:07','10:08',()=>()=>released++);h.track.dispatchEvent(h.pointer('pointerdown',90));h.track.ownerDocument={...h.document,defaultView:new EventTarget()};
 h.win.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');assert.equal(released,1);h.picker.destroy();
});
test('lost pointer capture cancels fifty previews and leaves no Escape scope behind',()=>{
 let acquired=0,released=0,captured=0;const h=control('09:07','10:08',()=>{acquired++;return ()=>released++;});(h.track as any).setPointerCapture=()=>captured++;
 for(let i=0;i<50;i++){h.track.dispatchEvent(h.pointer('pointerdown',90));h.win.dispatchEvent(h.pointer('pointermove',100));h.track.dispatchEvent(h.pointer('lostpointercapture',100));h.win.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');}
 assert.equal(acquired,50);assert.equal(released,50);assert.equal(captured,50);h.picker.destroy();
});
test('fifty end-handle keyboard edits send only the changed field and boundary repeats send none',()=>{
 const h=control('09:07','10:08'),endHandle=h.track.children[2];let fromEvents=0,toEvents=0;h.start.addEventListener('input',()=>fromEvents++);h.end.addEventListener('input',()=>toEvents++);
 const key=(value:string,shiftKey=false)=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:value,shiftKey});Object.defineProperty(event,'target',{value:endHandle});h.track.dispatchEvent(event);};
 for(let i=0;i<50;i++)key('ArrowRight',true);assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:58');assert.equal(fromEvents,0);assert.equal(toEvents,50);
 key('End');const count=toEvents;for(let i=0;i<50;i++)key('End');assert.equal(toEvents,count);assert.equal(h.end.value,'23:59');h.picker.destroy();
});
test('disabled inputs block fifty end-handle keyboard steps as well as pointer gestures',()=>{
 const h=control(),endHandle=h.track.children[2];h.start.disabled=h.end.disabled=true;h.picker.refresh();let changes=0;h.end.addEventListener('input',()=>changes++);
 for(let i=0;i<50;i++){const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'ArrowRight'});Object.defineProperty(event,'target',{value:endHandle});h.track.dispatchEvent(event);}
 assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');assert.equal(changes,0);h.picker.destroy();
});
test('new-window-only release after immediate adoption releases the scope and first retry works',()=>{
 let released=0,observed=0,disconnected=0,notify!:()=>void;
 const h=control('09:07','10:08',()=>()=>released++),next:any=new EventTarget();next.Event=Event;
 h.win.MutationObserver=class {constructor(callback:()=>void){notify=callback;}observe(){observed++;}disconnect(){disconnected++;}};
 h.track.dispatchEvent(h.pointer('pointerdown',90));const nextDocument={...h.document,defaultView:next};h.track.ownerDocument=h.root.ownerDocument=h.start.ownerDocument=h.end.ownerDocument=nextDocument;
 notify();next.dispatchEvent(h.pointer('pointerup',100));assert.equal(released,1);assert.equal(disconnected,1);assert.equal(h.start.value,'09:07');assert.equal(h.end.value,'10:08');
 h.track.dispatchEvent(h.pointer('pointerdown',90));next.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.start.value,'09:00');assert.equal(h.end.value,'10:00');assert.equal(released,2);assert.equal(observed,1);h.picker.destroy();
});
test('a stale cross-window gesture cannot block the first retry before the migration observer runs',()=>{
 let released=0;const h=control('09:07','10:08',()=>()=>released++),next:any=new EventTarget();next.Event=Event;
 h.track.dispatchEvent(h.pointer('pointerdown',90));const nextDocument={...h.document,defaultView:next};h.track.ownerDocument=h.root.ownerDocument=h.start.ownerDocument=h.end.ownerDocument=nextDocument;
 next.dispatchEvent(h.pointer('pointerup',100));assert.equal(h.start.value,'09:07');h.track.dispatchEvent(h.pointer('pointerdown',90));next.dispatchEvent(h.pointer('pointerup',100));
 assert.equal(h.start.value,'09:00');assert.equal(h.end.value,'10:00');assert.equal(released,2);h.picker.destroy();
});
