import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarTimeRange} from '../src/calendar-range-selection';

test('week selection snaps both edges to 15 minutes and preserves reversed ranges',()=>{
 assert.deepEqual(calendarTimeRange(548,667),{start:555,end:660});
 assert.deepEqual(calendarTimeRange(690,602),{start:600,end:690});
});
test('a drag within one snapped interval retains a positive minimum duration',()=>{
 assert.deepEqual(calendarTimeRange(540,542),{start:540,end:555});
 assert.deepEqual(calendarTimeRange(0,0),{start:0,end:15});
});
test('selection is clamped to the selected civil day including its 23:59 edge',()=>{
 assert.deepEqual(calendarTimeRange(1425,1460),{start:1425,end:1439});
 assert.deepEqual(calendarTimeRange(1440,1440),{start:1425,end:1439});
 assert.deepEqual(calendarTimeRange(1600,-100),{start:0,end:1439});
});
test('invalid pointer coordinates never become a draft time',()=>{
 assert.throws(()=>calendarTimeRange(NaN,540),/时间无效/);
 assert.throws(()=>calendarTimeRange(540,Infinity),/时间无效/);
});
