import test from 'node:test';
import assert from 'node:assert/strict';
import {planTasks} from '../src/task-planner-model';
import {journalRecords} from '../src/day-timeline-model';
import {timelineSelection} from '../src/timeline-selection';
const day='2026-10-11',path='Journal/2026-10-11.md';
const tasks=planTasks('- [ ] 09:00 阅读 #work\n- [x] 10:00 写作 #work\n- [ ] 尚未定时 #work\n- [ ] 11:00 买菜 #home\n- [ ] 12:00 明天 #work ⏳ 2026-10-12',path,'Journal');
test('timeline searches scheduled, completed and untimed tasks while keeping selected day',()=>{
 const all=timelineSelection(tasks,day,[],'','#work');assert.deepEqual(all.items.map(i=>i.title),['阅读 #work','写作 #work']);assert.equal(all.untimed.length,1);
 assert.deepEqual(timelineSelection(tasks,day,[],'写作','#work').items.map(i=>i.task?.checked),[true]);
 assert.equal(timelineSelection(tasks,day,[],' JOURNAL/ ','').items.length,3);
});
test('timeline tag matches complete names and journal records obey the same query',()=>{
 const records=journalRecords('## 13:00 会议 #work\n## 14:00 阅读 #workshop\n## 15:00 内容 `#work`',path);
 assert.deepEqual(timelineSelection([],day,records,'会议','#work').items.map(i=>i.title),['会议 #work']);
 assert.equal(timelineSelection([],day,records,'','#work').items.length,1);
});

test('a hidden overlapping task still marks the visible task as conflicting',()=>{
 const rows=planTasks('- [ ] 09:00 - 11:00 Visible #work\n- [ ] 10:00 - 12:00 Hidden #home',path,'Journal');
 const result=timelineSelection(rows,day,[],'visible','#work');assert.equal(result.items.length,1);assert.equal(result.items[0].conflict,true);
});
