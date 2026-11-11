import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameEvent } from '../shared/game';
import { freshGameEvents, gameEventSound, GAME_SOUND_PREFERENCE_KEY, readGameSoundPreference, writeGameSoundPreference } from './game-event-effects';
import { GameAudioController } from './game-audio';

function event(id:string,sequence:number,kind:GameEvent['kind']='discard'):GameEvent{return{id,sequence,matchId:'match-test',round:1,turnId:'turn-1',at:sequence,kind,playerId:'player-1'}}

test('initial snapshot and reconnect baseline do not replay old game effects',()=>{
  const seen=new Set<string>();
  assert.deepEqual(freshGameEvents([event('old-1',1),event('old-2',2)],seen,true),[]);
  assert.deepEqual(freshGameEvents([event('old-1',1),event('old-2',2)],seen),[]);
  assert.deepEqual(freshGameEvents([event('new-3',3)],seen),[event('new-3',3)]);
});

test('repeated room state only returns an event once and sorts simultaneous events',()=>{
  const seen=new Set<string>(),incoming=[event('second',2,'finish'),event('first',1,'draw-stock'),event('first',1,'draw-stock')];
  assert.deepEqual(freshGameEvents(incoming,seen).map(item=>item.id),['first','second']);
  assert.deepEqual(freshGameEvents(incoming,seen),[]);
});

test('event categories map to the intended one-shot sounds',()=>{
  assert.equal(gameEventSound('draw-stock'),'draw');
  assert.equal(gameEventSound('draw-discard'),'draw');
  assert.equal(gameEventSound('discard'),'discard');
  assert.equal(gameEventSound('meld-lay'),'process');
  assert.equal(gameEventSound('open-series'),'open');
  assert.equal(gameEventSound('open-pairs'),'open');
  assert.equal(gameEventSound('finish'),'finish');
  assert.equal(gameEventSound('penalty'),'penalty');
});

test('sound preference persists locally and defaults to muted',()=>{
  const entries=new Map<string,string>();
  const storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value)}};
  assert.equal(readGameSoundPreference(storage),false);
  writeGameSoundPreference(storage,true);
  assert.equal(entries.get(GAME_SOUND_PREFERENCE_KEY),'true');
  assert.equal(readGameSoundPreference(storage),true);
  writeGameSoundPreference(storage,false);
  assert.equal(readGameSoundPreference(storage),false);
});

test('audio remains silent until enabled and unlocked; disabling stops playback',async()=>{
  let unlocks=0,plays=0,stops=0;
  const audio=new GameAudioController({unlock:async()=>{unlocks++;return true},play:async()=>{plays++},stop:()=>{stops++}});
  audio.play('draw');
  assert.equal(plays,0);
  audio.setEnabled(true);
  audio.play('draw');
  assert.equal(plays,0);
  assert.equal(await audio.unlockFromUserGesture(),true);
  audio.play('draw');
  await Promise.resolve();
  assert.equal(unlocks,1);
  assert.equal(plays,1);
  audio.setEnabled(false);
  assert.ok(stops>=2);
  audio.play('finish');
  assert.equal(plays,1);
});

test('rapid audio events stop the previous effect instead of overlapping',async()=>{
  const calls:string[]=[];
  const audio=new GameAudioController({unlock:async()=>true,play:async(effect)=>{calls.push(effect)},stop:()=>{calls.push('stop')}});
  audio.setEnabled(true);await audio.unlockFromUserGesture();
  audio.play('draw');audio.play('discard');await Promise.resolve();
  assert.deepEqual(calls,['stop','draw','stop','discard']);
});
