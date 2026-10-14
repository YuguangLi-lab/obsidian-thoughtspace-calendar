import {App,Scope} from 'obsidian';

/** Obsidian handles modal Escape before DOM listeners. Own the key only during a gesture. */
export function timeRangeEscape(app:App,parent:Scope):(cancel:()=>void)=>()=>void {
 return cancel=>{
  const scope=new Scope(parent);let active=true;
  scope.register(null,'Escape',event=>{event.preventDefault();cancel();return false;});
  app.keymap.pushScope(scope);
  return ()=>{if(active){active=false;app.keymap.popScope(scope);}};
 };
}
