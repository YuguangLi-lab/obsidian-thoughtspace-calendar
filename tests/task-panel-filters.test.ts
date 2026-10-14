import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {planTasks} from '../src/task-planner-model';

class ElementStub {
 children:ElementStub[]=[];parent?:ElementStub;dataset:Record<string,string>={};attrs=new Map<string,string>();className='';textContent='';hidden=false;disabled=false;value='';scrollTop=0;open=false;style={setProperty(){}};
 onclick?:()=>unknown;oninput?:()=>unknown;onchange?:()=>unknown;
 constructor(public ownerDocument:any,public tagName='div'){}
 createEl(tag:string,args:any={}){const element=new ElementStub(this.ownerDocument,tag);element.className=args.cls||'';element.textContent=args.text||'';element.value=args.value||'';for(const [name,value]of Object.entries(args.attr||{}))element.setAttribute(name,String(value));element.parent=this;this.children.push(element);return element;}
 createDiv(args:any={}){return this.createEl('div',typeof args==='string'?{cls:args}:args);}
 createSpan(args:any={}){return this.createEl('span',args);}
 addClass(...names:string[]){this.className=[this.className,...names].filter(Boolean).join(' ');}
 removeClass(...names:string[]){this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ');}
 toggleClass(name:string,enabled:boolean){this.removeClass(name);if(enabled)this.addClass(name);}
 setAttribute(name:string,value:string){this.attrs.set(name,value);}
 getAttribute(name:string){return name.startsWith('data-')?this.dataset[name.slice(5)]||null:this.attrs.get(name)||null;}
 setText(text:string){this.textContent=text;}
 empty(){if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;for(const child of this.children)child.parent=undefined;this.children=[];this.textContent='';}
 contains(element:ElementStub|null):boolean{return this===element||this.children.some(child=>child.contains(element));}
 matches(selector:string){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));const match=selector.match(/^(\w+)?(?:\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\])?$/);return !!match&&(!match[1]||match[1]===this.tagName)&&(!match[2]||(match[3]===undefined?this.getAttribute(match[2])!==null:this.getAttribute(match[2])===match[3]));}
 querySelectorAll(selector:string):ElementStub[]{return this.children.flatMap(child=>[...(selector.split(',').some(part=>child.matches(part))?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector:string){return this.querySelectorAll(selector)[0]||null;}
 closest(selector:string):ElementStub|null{return this.matches(selector)?this:this.parent?.closest(selector)||null;}
 focus(){this.ownerDocument.activeElement=this;}
 getClientRects(){return [{}];}
 get isConnected():boolean{return this===this.ownerDocument.body||!!this.parent?.isConnected;}
 get lastElementChild(){return this.children.at(-1);}
}
const code=buildSync({entryPoints:['src/task-planner-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
const day='2026-10-14';
function host(markdown:string,state:any={}){
 const module={exports:{} as any};class Base {register(){}registerDomEvent(){}addChild(){}removeChild(){}}
 new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return new Proxy({setIcon:()=>{}},{get:(target,key)=>key in target?(target as any)[key]:Base});throw Error(id);},module,module.exports);
 const document:any={activeElement:null};document.body=new ElementStub(document,'body');const root:ElementStub=document.body.createDiv();
 const source=planTasks(markdown,'Tasks.md','Journal'),planner={all:()=>source,ready:()=>new Promise(()=>{}),subscribe:()=>()=>{},canUndo:()=>false,canToggle:()=>true,focusKey:(task:any)=>task.source,failures:new Map(),update:()=>{throw Error('Filters must not change task Markdown');}};
 const panel=new module.exports.TaskPanel({workspace:{requestSaveLayout(){}}},root,planner,day,state,true);panel.onload();panel.render();
 return {panel,root,state,source,document};
}
const markdown=`- [ ] Today #work ⏳ ${day}\n- [ ] Later #home ⏳ 2026-10-15\n- [x] Finished #work ✅ ${day}\n- [ ] Old #work 📅 2026-10-13`;

test('one compact scope row filters tasks without repeating count, scope or date metadata',()=>{
 const h=host(markdown),scopes=h.root.querySelector('.ts-task-scope-switch')!;
 assert.equal(scopes.children.length,4);assert.equal(scopes.children[0].children[0].textContent,'当天待办');assert.equal(scopes.children[0].children[1].tagName,'strong');
 assert.equal(h.root.querySelectorAll('.ts-task-result-header').length,0);assert.equal(h.root.querySelectorAll('.ts-task-result-count').length,0);
 const done=scopes.querySelector('button[data-filter=done]')!;done.focus();done.onclick!();
 assert.equal(h.panel.filter,'done');assert.equal(h.root.querySelectorAll('.ts-task-row').length,1);assert.equal(h.root.querySelector('.ts-task-title')!.children[0].textContent,'Finished');
 assert.equal(h.root.querySelectorAll('.ts-task-result-header').length,0);assert.equal(h.document.activeElement,h.root.querySelector('button[data-filter=done]'));
 assert.equal(h.root.querySelector('summary')!.textContent,'更多筛选');
});

test('search and tag show a short result count and clear without changing the selected scope',()=>{
 const h=host(markdown,{filter:'unfinished',query:'today',tag:'#work',filtersOpen:true});
 assert.equal(h.root.querySelector('.ts-task-result-count')!.textContent,'1 项匹配');assert.equal(h.root.querySelector('.ts-task-result-count')!.getAttribute('role'),'status');
 assert.equal(h.root.querySelector('.ts-task-filter-disclosure')!.open,true);
 h.root.querySelector('button[aria-label=清除任务搜索和标签]')!.onclick!();
 assert.equal(h.panel.filter,'unfinished');assert.equal(h.panel.query,'');assert.equal(h.panel.tag,'');assert.equal(h.root.querySelectorAll('.ts-task-result-header').length,0);assert.equal(h.root.querySelectorAll('.ts-task-row').length,3);
 assert.deepEqual(h.source.map(task=>task.text),planTasks(markdown,'Tasks.md','Journal').map(task=>task.text));
});

test('more filters retains advanced ranges and exposes all ranges in quadrants',()=>{
 const h=host(markdown),ranges=h.root.querySelector('.ts-task-filters')!;
 assert.deepEqual(ranges.children.filter(button=>!button.hidden).map(button=>button.textContent),['未来七天','未安排','时间线','全部已完成']);
 ranges.children.find(button=>button.textContent==='未来七天')!.onclick!();assert.equal(h.panel.filter,'upcoming');assert.equal(h.root.querySelectorAll('.ts-task-row').length,1);assert.equal(h.root.querySelector('summary')!.textContent,'更多筛选 · 未来七天');
 h.panel.view='quadrants';h.panel.render();assert.equal(ranges.children.filter(button=>!button.hidden).length,8);assert.equal(h.root.querySelectorAll('.ts-task-quadrant').length,4);assert.equal(h.root.querySelectorAll('.ts-task-result-header').length,0);
});

test('an empty list uses one hint and empty quadrants remain drop targets',()=>{
 const h=host('',{filter:'done'});assert.equal(h.root.querySelectorAll('.ts-task-empty').length,1);assert.equal(h.root.querySelector('.ts-task-empty')!.textContent,'此范围暂无任务');assert.equal(h.root.querySelectorAll('.ts-task-result-header').length,0);
 h.panel.view='quadrants';h.panel.render();assert.equal(h.root.querySelectorAll('.ts-task-empty').length,0);assert.equal(h.root.querySelectorAll('.ts-task-quadrant-empty').length,4);
 assert(h.root.querySelectorAll('.ts-task-quadrant').every((box:any)=>typeof box.ondragover==='function'&&typeof box.ondrop==='function'));
});
