import type { GameEvent, GameEventKind } from '../shared/game';

export type GameSoundEffect='draw'|'discard'|'process'|'open'|'finish'|'penalty';
export const GAME_SOUND_PREFERENCE_KEY='mentalGameSoundEffects';

export function freshGameEvents(events:readonly GameEvent[],seen:Set<string>,baseline=false):GameEvent[]{
  if(baseline){
    for(const event of events)seen.add(event.id);
    trimSeenIds(seen);
    return [];
  }
  const fresh:GameEvent[]=[];
  for(const event of [...events].sort((left,right)=>left.sequence-right.sequence)){
    if(seen.has(event.id))continue;
    seen.add(event.id);
    fresh.push(event);
  }
  trimSeenIds(seen);
  return fresh;
}

function trimSeenIds(seen:Set<string>):void{
  while(seen.size>300){
    const oldest=seen.values().next().value as string|undefined;
    if(oldest===undefined)break;
    seen.delete(oldest);
  }
}

export function gameEventSound(kind:GameEventKind):GameSoundEffect|null{
  switch(kind){
    case 'draw-stock':
    case 'draw-discard':return 'draw';
    case 'discard':return 'discard';
    case 'meld-lay':return 'process';
    case 'open-series':
    case 'open-pairs':return 'open';
    case 'finish':return 'finish';
    case 'penalty':return 'penalty';
    default:return null;
  }
}

export function readGameSoundPreference(storage:Pick<Storage,'getItem'>):boolean{
  try{return storage.getItem(GAME_SOUND_PREFERENCE_KEY)==='true'}catch{return false}
}

export function writeGameSoundPreference(storage:Pick<Storage,'setItem'>,enabled:boolean):void{
  try{storage.setItem(GAME_SOUND_PREFERENCE_KEY,String(enabled))}catch{/* Storage can be disabled; audio remains session-local. */}
}
