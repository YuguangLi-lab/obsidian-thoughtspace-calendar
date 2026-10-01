import { sage, sageDark } from '@radix-ui/colors';
/** Official Radix Colors, scoped to this plugin. No global CSS reset. */
export function designTokens(doc:Document){const el=doc.createElement('style');el.dataset.thoughtspaceTokens='true';
 const css=(colors:typeof sage,theme:string)=>`${theme} :is(.ts-calendar-plugin){${Object.entries(colors).map(([k,v])=>`--ts-ui-${k.replace('sage','')}:${v};`).join('')}}`;
 el.textContent=css(sage,'.theme-light')+css(sageDark,'.theme-dark');doc.head.appendChild(el);return el;
}

/** Carry the active workspace's appearance into plugin-owned dialogs only. */
export function themeSurface(el:HTMLElement,appearance?:{accent?:string;glassEffects?:boolean}) {
  const source=el.ownerDocument.querySelector<HTMLElement>('.ts-calendar-plugin.ts-journal,.ts-calendar-plugin.ts-task-planner');
  el.addClass('ts-ui-modal');el.addClass('ts-calendar-plugin');el.dataset.surface=source?.dataset.surface||'soft';el.dataset.accent=appearance?.accent||source?.dataset.accent||'forest';el.dataset.glass=String(appearance?.glassEffects??(source?.dataset.glass!=='false'));
}
