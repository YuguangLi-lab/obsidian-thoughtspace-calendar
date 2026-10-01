import {ChineseCalendarOptions} from './chinese-calendar';
import {defaultFilingSettings,validateFolders} from './filing';
import {AppleCalendarSettings,defaultAppleSettings} from './calendar-model';
export interface CalendarSettings extends ChineseCalendarOptions{journalFolder:string;cardFolder:string;surfaceStyle:'soft'|'paper';accent:'forest'|'blue'|'amber'|'rose';glassEffects:boolean;linkCreatedNotes:boolean;appleCalendar:AppleCalendarSettings;migratedFrom?:string;}
export function appleCalendarSettings(value:unknown):AppleCalendarSettings{
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 return {...defaultAppleSettings,enabled:raw.enabled===true,
  selectedCalendarIds:Array.isArray(raw.selectedCalendarIds)?[...new Set(raw.selectedCalendarIds.filter((id):id is string=>typeof id==='string'&&id.length>0&&id.length<=1024))].slice(0,200):[],
  defaultCalendarId:typeof raw.defaultCalendarId==='string'&&raw.defaultCalendarId.length<=1024?raw.defaultCalendarId:''};
}
export function calendarSettings(saved:unknown,legacy?:unknown):CalendarSettings{
 const own=!!saved&&typeof saved==='object',raw=(own?saved:legacy&&typeof legacy==='object'?legacy:{}) as Record<string,unknown>;
 const folders=validateFolders(typeof raw.cardFolder==='string'?raw.cardFolder:defaultFilingSettings.cardFolder,typeof raw.journalFolder==='string'?raw.journalFolder:defaultFilingSettings.journalFolder);
 return{...folders,showLunar:raw.showLunar!==false,showFestivals:raw.showFestivals!==false,showSolarTerms:raw.showSolarTerms!==false,showHolidays:raw.showHolidays!==false,calendarDensity:raw.calendarDensity==='compact'?'compact':'comfortable',surfaceStyle:raw.surfaceStyle==='paper'?'paper':'soft',accent:['forest','blue','amber','rose'].includes(String(raw.accent))?raw.accent as CalendarSettings['accent']:'forest',glassEffects:raw.glassEffects!==false,linkCreatedNotes:raw.linkCreatedNotes!==false,appleCalendar:appleCalendarSettings(own?raw.appleCalendar:undefined),...(!own&&legacy?{migratedFrom:'thoughtspace'}:typeof raw.migratedFrom==='string'?{migratedFrom:raw.migratedFrom}:{})};
}
