import {Board,Card} from './model';
import {branchState} from './mindmap';
export type MaterialPoint={x:number;y:number;targetId?:string};
/** Reverse paint order, excluding folded descendants. A locked target is rejected, not bypassed. */
export function evidenceTarget(board:Board,point:{x:number;y:number}):Card|undefined{
 const hidden=branchState(board).hidden;
 return [...board.nodes].reverse().find(n=>n.kind==='card'&&!hidden.has(n.id)&&point.x>=n.x&&point.x<=n.x+n.width&&point.y>=n.y&&point.y<=n.y+n.height);
}
export function appendEvidence(raw:string,evidence:string){
 if(!evidence.trim())throw Error('摘录为空');if(evidence.length>500000)throw Error('单次证据过长，请分段拖入');
 const eol=raw.includes('\r\n')?'\r\n':'\n',block='> [!quote] 证据摘录'+eol+evidence.replace(/\r\n?/g,'\n').split('\n').map(line=>'> '+line).join(eol);
 return raw+(raw.endsWith(eol+eol)?'':raw.endsWith(eol)?eol:eol+eol)+block+eol;
}
