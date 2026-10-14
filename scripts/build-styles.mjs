import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {readFile,writeFile} from 'node:fs/promises';
const root=postcss.parse(await readFile('src/calendar-styles-source.css','utf8')+'\n'+await readFile('src/calendar-design.css','utf8')+'\n'+await readFile('src/journal-design.css','utf8')+'\n'+await readFile('src/planner-design.css','utf8')+'\n'+await readFile('src/large-calendar.css','utf8')+'\n'+await readFile('src/pomodoro.css','utf8')+'\n'+await readFile('src/pomodoro-strip.css','utf8'));
const keptClass=/^tsc-|^ts-(?:journal|calendar|task|timeline|day-timeline|schedule)(?:-|$)|^ts-(?:ui-modal|muted|text-modal|editor|settings)$/;
root.walkComments(comment=>comment.remove());
root.walkAtRules(rule=>{if(/keyframes$/i.test(rule.name))rule.remove();});
root.walkRules(rule=>{
 const ast=selectorParser().astSync(rule.selector),keep=[];
 ast.each(selector=>{
  let relevant=false;selector.walkClasses(node=>{if(keptClass.test(node.value))relevant=true;});if(!relevant)return;
  const scope=selectorParser().astSync(':where(.ts-calendar-plugin, .ts-calendar-plugin *)').first.first.clone();
  const pseudo=selector.nodes.find(node=>node.type==='pseudo'&&node.value.startsWith('::'));if(pseudo)selector.insertBefore(pseudo,scope);else selector.append(scope);
  keep.push(selector.toString());
 });
 if(!keep.length)rule.remove();else rule.selector=keep.join(',');
});
let changed=true;while(changed){changed=false;root.walkAtRules(rule=>{if(!rule.nodes?.length){rule.remove();changed=true;}});}
await writeFile('styles.css','/* Scoped styles for the independent calendar plugin. */\n'+root.toString());
