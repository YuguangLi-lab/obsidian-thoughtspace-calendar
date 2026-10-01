import {HolidayUtil,Solar} from 'lunar-typescript';
import {dateOf} from './calendar-tools';
export interface ChineseCalendarOptions {showLunar?:boolean;showFestivals?:boolean;showSolarTerms?:boolean;showHolidays?:boolean;calendarDensity?:'comfortable'|'compact';}
export interface ChineseDay {
 readonly day:string;readonly lunarDate:string;readonly lunarLabel:string;readonly chineseYear:string;
 readonly festivals:readonly string[];readonly solarTerm:string;readonly holiday?:Readonly<{name:string;work:boolean}>;
 readonly holidaysKnown:boolean;
}
/** Cache plain immutable values only: Lunar/Solar retain much larger calculation graphs. */
export class ChineseCalendar {
 private days=new Map<string,ChineseDay>();private coverage=new Map<number,boolean>();
 constructor(private limit=512){}
 get size(){return this.days.size;}
 get(day:string):ChineseDay|undefined {
  const date=dateOf(day),year=date.getFullYear();if(year<1900||year>2100)return;
  const cached=this.days.get(day);if(cached){this.days.delete(day);this.days.set(day,cached);return cached;}
  const solar=Solar.fromYmd(year,date.getMonth()+1,date.getDate()),lunar=solar.getLunar(),holiday=HolidayUtil.getHoliday(day);
  let holidaysKnown=this.coverage.get(year);if(holidaysKnown===undefined){holidaysKnown=HolidayUtil.getHolidays(year).length>0;this.coverage.set(year,holidaysKnown);if(this.coverage.size>16)this.coverage.delete(this.coverage.keys().next().value!);}
  const chineseYear=`${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年`,lunarMonth=lunar.getMonthInChinese()+'月',lunarDay=lunar.getDayInChinese();
  const value:ChineseDay=Object.freeze({day,chineseYear,lunarDate:`${chineseYear}${lunarMonth}${lunarDay}`,lunarLabel:lunar.getDay()===1?lunarMonth:lunarDay,festivals:Object.freeze([...new Set([...lunar.getFestivals(),...solar.getFestivals()])]),solarTerm:lunar.getJieQi(),holiday:holiday?Object.freeze({name:holiday.getName(),work:holiday.isWork()}):undefined,holidaysKnown});
  this.days.set(day,value);while(this.days.size>Math.max(1,this.limit))this.days.delete(this.days.keys().next().value!);return value;
 }
 clear(){this.days.clear();this.coverage.clear();}
}
export function chineseDayPresentation(value:ChineseDay|undefined,options:ChineseCalendarOptions={}){
 if(!value)return {label:'',kind:'lunar',description:'',badge:'',holidayTitle:''};
 const festival=options.showFestivals!==false?value.festivals.join(' / '):'',term=options.showSolarTerms!==false?value.solarTerm:'',lunar=options.showLunar!==false?value.lunarLabel:'';
 const holiday=options.showHolidays!==false?value.holiday:undefined;
 return {label:festival||term||lunar,kind:festival?'festival':term?'term':'lunar',description:[options.showLunar!==false?'农历 '+value.lunarDate:'',festival,term,holiday?`${festival.includes(holiday.name)?'':holiday.name+' · '}${holiday.work?'调休上班':'放假'}`:''].filter(Boolean).join(' · '),badge:holiday?(holiday.work?'班':'休'):'',holidayTitle:holiday?`${festival.includes(holiday.name)?'':holiday.name+' · '}${holiday.work?'调休上班':'放假'}`:''};
}
