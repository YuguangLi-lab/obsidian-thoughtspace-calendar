import type {App} from 'obsidian';
import {planTasks,type PlannedTask} from './task-planner-model';

/** Optional API documented by obsidian-tasks-group; never retain a disabled plugin. */
export interface TasksToggleApi {
 executeToggleTaskDoneCommand(line:string,path:string):string;
}
export function tasksToggleApi(app:App):TasksToggleApi|undefined {
 const plugins=(app as unknown as {plugins?:{plugins?:Record<string,{apiV1?:unknown}>}}).plugins?.plugins;
 const api=plugins?.['obsidian-tasks-plugin']?.apiV1 as Partial<TasksToggleApi>|undefined;
 return typeof api?.executeToggleTaskDoneCommand==='function'?api as TasksToggleApi:undefined;
}

export const TASKS_REQUIRED='重复任务需要启用 Tasks 7.2 或更新版本，也可以在原文完成';
export const TASKS_REPEAT_NOT_GENERATED='Tasks 未生成下一次任务，未修改原文。请检查重复规则、Tasks 全局过滤器和任务格式；规则已结束时请在原文完成';
const taskLine=/^(?:(?: {0,3}>[\t ]?)+)?[\t ]*(?:[-*+]|\d+[.)])[\t ]+\[([ xX])\][\t ]+\S/;
const blockId=(line:string)=>line.match(/\s+(\^[A-Za-z0-9-]+)\s*$/)?.[1];

/** Keep the API's recurrence order and metadata; normalize only the existing line ending. */
export function tasksToggleLines(api:TasksToggleApi,task:PlannedTask,newline:'\n'|'\r\n'=task.source.endsWith('\r')?'\r\n':'\n'):string[] {
 const source=task.source.replace(/\r$/,''),result=api.executeToggleTaskDoneCommand(source,task.path);
 if(typeof result!=='string'||!result.trim())throw Error('Tasks 返回了删除操作或空内容，请在原文完成此任务');
 if(result.length>1_000_000)throw Error('Tasks 返回的内容过长，请在原文完成此任务');
 const lines=result.replace(/\r\n/g,'\n').split('\n');
 // The API contract allows one updated task or two tasks after recurrence. Reject
 // unsupported custom statuses instead of silently dropping them from this index.
 if(lines.length>2||lines.some(line=>!taskLine.test(line)||line.includes('\r')))
  throw Error('Tasks 返回了暂不支持的任务状态或格式，请在原文完成此任务');
 const id=blockId(source);
 if(id&&lines.filter(line=>blockId(line)===id).length!==1)
  throw Error('Tasks 返回的内容改变了任务块引用，请在原文检查');
 // Tasks deliberately falls back to a plain checkbox toggle when its global
 // filter does not match. A finite recurrence can also return a single row;
 // the public API cannot disambiguate it, so leave that case to the source.
 const updated=planTasks(lines.join('\n'),task.path,'');
 if(!task.checked){
  if(updated.length!==2||updated.filter(row=>row.checked).length!==1||updated.filter(row=>!row.checked&&row.recurring).length!==1)
   throw Error(TASKS_REPEAT_NOT_GENERATED);
 }else if(updated.length!==1||updated[0].checked){
  throw Error('Tasks 未重新打开此任务，未修改原文，请在原文检查任务状态');
 }
 const ending=task.source.endsWith('\r')?'\r':'';
 return lines.map((line,index)=>line+(index<lines.length-1&&newline==='\r\n'?'\r':ending));
}

/** Bounded optimistic replacement. A stale action never rewrites another row. */
export function replaceTaskSpan(text:string,line:number,expected:readonly string[],replacement:readonly string[]):string {
 const lines=text.split('\n');
 if(!Number.isInteger(line)||line<0||!expected.length||expected.some((value,index)=>lines[line+index]!==value))
  throw Error('任务原文已变化，请刷新后再操作');
 lines.splice(line,expected.length,...replacement);
 return lines.join('\n');
}
