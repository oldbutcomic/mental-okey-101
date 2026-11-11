import type { MatchBadge } from '../shared/game';

/** Shows only in-match results (leaving the final match result for the results screen). */
export function visibleMatchBadgeRows(badges:MatchBadge[],totalRounds:number):MatchBadge[][] {
  const visibleLimit=Math.max(0,Math.min(10,totalRounds-1));
  const visible=[...badges].sort((a,b)=>a.round-b.round).slice(0,visibleLimit);
  if(!visible.length)return [];
  const firstRowSize=Math.ceil(visible.length/2);
  return [visible.slice(0,firstRowSize),visible.slice(firstRowSize)].filter(row=>row.length>0);
}
