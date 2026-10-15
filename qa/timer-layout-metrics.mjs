/** Browser-only measurements, shared by the embedded and compatibility-panel checks. */
export function timerLayoutMetrics(root) {
 const visible=el=>!!el&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0;
 const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const box=rect(root),clock=root.querySelector('.ts-calendar-pomodoro-clock'),dial=root.querySelector('.ts-calendar-pomodoro-dial'),hero=root.querySelector('.ts-calendar-pomodoro-timer');
 const c=rect(clock),d=rect(dial),scale=box.width/root.offsetWidth;
 const ring=root.querySelector('.ts-calendar-pomodoro-ring-remaining'),stroke=parseFloat(getComputedStyle(ring).strokeWidth)||0;
 // The SVG has a 220-unit view box and a radius of 101. Corners must stay within its inner edge.
 const radius=(101-stroke/2)/220*d.width-2*scale,cx=(d.left+d.right)/2,cy=(d.top+d.bottom)/2;
 const corners=[[c.left,c.top],[c.right,c.top],[c.left,c.bottom],[c.right,c.bottom]];
 const insideRing=corners.every(([x,y])=>(x-cx)**2+(y-cy)**2<=radius**2);
 const gap=Math.max(d.left-c.right,c.left-d.right,d.top-c.bottom,c.top-d.bottom)/scale;
 const framed=el=>{const style=getComputedStyle(el);return parseFloat(style.borderTopWidth)>0&&style.borderTopStyle!=='none'&&style.borderTopColor!=='rgba(0, 0, 0, 0)';};
 return {
  overflow:root.scrollWidth>root.clientWidth+1,
  clockFits:clock.scrollWidth<=clock.clientWidth+1,
  font:parseFloat(getComputedStyle(clock).fontSize),
  clock:c,ring:d,gap,insideRing,scale,
  clockClearOfRing:gap>=3.5||insideRing,
  controls:[...root.querySelectorAll('button,input')].filter(visible).every(el=>{const r=rect(el);return r.left>=box.left-1&&r.right<=box.right+1;}),
  heroHeight:hero.getBoundingClientRect().height/scale,
  nestedFrames:Number(framed(root))+Number(framed(hero)),
  panelHeight:box.height/scale,
 };
}
