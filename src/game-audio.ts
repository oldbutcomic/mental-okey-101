import type { GameSoundEffect } from './game-event-effects';

type AudioOutput={unlock:()=>Promise<boolean>;play:(effect:GameSoundEffect)=>Promise<void>;stop:(suspend?:boolean)=>void};

export class GameAudioController{
  private enabled=false;
  private unlocked=false;
  constructor(private readonly output:AudioOutput){}
  setEnabled(enabled:boolean):void{
    this.enabled=enabled;
    if(!enabled){this.unlocked=false;this.output.stop(true)}
  }
  async unlockFromUserGesture():Promise<boolean>{
    if(!this.enabled)return false;
    try{this.unlocked=await this.output.unlock();return this.unlocked}catch{this.unlocked=false;return false}
  }
  play(effect:GameSoundEffect):void{
    if(!this.enabled||!this.unlocked)return;
    this.output.stop();
    void this.output.play(effect).catch(()=>{/* Audio failures never affect a game action. */});
  }
}

type BrowserAudioContext=AudioContext;
const sourceUrls:Record<GameSoundEffect,string>={
  draw:new URL('./assets/audio/tile-draw.wav',import.meta.url).href,
  discard:new URL('./assets/audio/tile-discard.wav',import.meta.url).href,
  process:new URL('./assets/audio/tile-process.wav',import.meta.url).href,
  open:new URL('./assets/audio/meld-open.wav',import.meta.url).href,
  finish:new URL('./assets/audio/round-finish.wav',import.meta.url).href,
  penalty:new URL('./assets/audio/soft-penalty.wav',import.meta.url).href,
};

class BrowserAudioOutput implements AudioOutput{
  private context:BrowserAudioContext|null=null;
  private activeSource:AudioBufferSourceNode|null=null;
  private generation=0;
  private buffers=new Map<GameSoundEffect,Promise<AudioBuffer>>();
  async unlock():Promise<boolean>{
    try{
      const AudioContextConstructor=window.AudioContext;
      if(!AudioContextConstructor)return false;
      this.context??=new AudioContextConstructor();
      await this.context.resume();
      return this.context.state==='running';
    }catch{return false}
  }
  async play(effect:GameSoundEffect):Promise<void>{
    const context=this.context;
    if(!context||context.state!=='running')return;
    const generation=this.generation;
    let pending=this.buffers.get(effect);
    if(!pending){
      pending=fetch(sourceUrls[effect]).then(response=>{if(!response.ok)throw new Error('Audio asset unavailable');return response.arrayBuffer()}).then(data=>context.decodeAudioData(data));
      this.buffers.set(effect,pending);
    }
    const buffer=await pending;
    if(generation!==this.generation||context!==this.context||context.state!=='running')return;
    const source=context.createBufferSource(),gain=context.createGain();
    source.buffer=buffer;gain.gain.value=.18;source.connect(gain);gain.connect(context.destination);
    this.activeSource=source;
    source.onended=()=>{if(this.activeSource===source)this.activeSource=null};
    source.start();
  }
  stop(suspend=false):void{
    this.generation++;
    const source=this.activeSource;this.activeSource=null;
    if(source){try{source.stop()}catch{/* The source may already have ended. */}}
    if(suspend&&this.context?.state==='running')void this.context.suspend().catch(()=>{/* Audio shutdown is best-effort. */});
  }
}

export const gameAudio=new GameAudioController(new BrowserAudioOutput());
