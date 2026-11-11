import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { io as createIo, type Socket } from 'socket.io-client';

type PlayerState={id:string;seat:number;online:boolean;autoPlay?:boolean;score:number;tilesLeft:number;mentalCoins?:number};
type RoomState={status:string;matchId:string;turnId:string|null;turnPlayerId:string|null;phase:string;turnDeadlineAt:number|null;serverNow:number;players:PlayerState[];throwsByPlayer:Record<string,{id:number}[]>;playersHandLength?:number;hand?:{id:number}[]};
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function unusedPort():Promise<number>{const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const address=server.address();if(!address||typeof address==='string')throw new Error('ephemeral port allocation failed');const port=address.port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;}
function ack<T>(socket:Socket,event:string,payload:unknown,timeoutMs=10_000):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} acknowledgement timed out`)),timeoutMs);socket.emit(event,payload,(response:T)=>{clearTimeout(timer);resolve(response)})})}
function onceMatching<T>(socket:Socket,event:string,predicate:(value:T)=>boolean,timeoutMs=10_000):Promise<T>{return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);socket.off(event,listener)};const listener=(value:T)=>{if(!predicate(value))return;cleanup();resolve(value)};const timer=setTimeout(()=>{cleanup();reject(new Error(`Timed out waiting for ${event}`))},timeoutMs);socket.on(event,listener)})}
function connect(url:string,sessionToken?:string):Promise<Socket>{const socket=createIo(url,{autoConnect:false,auth:sessionToken?{sessionToken}:{},transports:['websocket'],reconnection:false,timeout:5_000,forceNew:true});socket.on('account:session-token',(event:{sessionToken:string})=>{if(event?.sessionToken)socket.auth={sessionToken:event.sessionToken}});socket.connect();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(new Error('Socket connect timed out'))},7_000);socket.once('connect',()=>{clearTimeout(timer);resolve(socket)});socket.once('connect_error',error=>{clearTimeout(timer);socket.close();reject(error)})})}
async function register(socket:Socket,username:string){const result=await ack<{ok:boolean;account?:{id:string};sessionToken?:string;error?:string}>(socket,'account:register',{username,pin:'481516'});assert.equal(result.ok,true,result.error);assert.ok(result.account?.id&&result.sessionToken);socket.auth={sessionToken:result.sessionToken};return{id:result.account!.id,sessionToken:result.sessionToken!}}
function roomState(socket:Socket,predicate:(state:RoomState)=>boolean,timeoutMs=10_000):Promise<RoomState>{return onceMatching(socket,'room:state',predicate,timeoutMs)}

test('Oto Mod Socket.IO devrinde oyuncu yuvası korunur, manuel hamle engellenir, reconnect bayrağı kalır ve kapatılan plan eylem üretmez',{timeout:45_000},async t=>{
  const port=await unusedPort(),root=process.cwd(),cli=path.join(root,'node_modules','tsx','dist','cli.mjs'),serverFile=path.join(root,'server','index.ts');
  const child:ChildProcessWithoutNullStreams=spawn(process.execPath,[cli,serverFile],{cwd:root,env:{...process.env,PORT:String(port),CLIENT_ORIGIN:'http://localhost:5173',NODE_ENV:'test',DEV_TEST_PANEL:'0'},stdio:['ignore','pipe','pipe']});
  const sockets:Socket[]=[];let output='';child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>output+=String(chunk));
  t.after(async()=>{for(const socket of sockets)socket.close();child.kill();await Promise.race([new Promise<void>(resolve=>child.once('exit',()=>resolve())),wait(3000)])});
  const readyUntil=Date.now()+12_000;while(!output.includes(`Mental Okey server listening on ${port}`)&&Date.now()<readyUntil){if(child.exitCode!==null)throw new Error(`test server exited: ${output}`);await wait(50)}assert.ok(output.includes(`Mental Okey server listening on ${port}`),output);
  const url=`http://127.0.0.1:${port}`;
  const latestStates=new Map<Socket,RoomState>();
  const watch=(socket:Socket)=>{socket.on('room:state',state=>latestStates.set(socket,state as RoomState));};
  const stateFor=(socket:Socket,predicate:(state:RoomState)=>boolean,timeoutMs=10_000,label='room state')=>{const latest=latestStates.get(socket);const result=latest&&predicate(latest)?Promise.resolve(latest):roomState(socket,predicate,timeoutMs);return result.catch(error=>{const snapshot=latestStates.get(owner?.socket);throw new Error(`${label}: ${error instanceof Error?error.message:String(error)}; latest=${JSON.stringify(snapshot?.players.map(player=>({id:player.id,online:player.online,autoPlay:player.autoPlay})))}`)})};
  const suffix=Date.now().toString().slice(-5);
  const players=await Promise.all(Array.from({length:4},async(_,seat)=>{const socket=await connect(url);sockets.push(socket);watch(socket);const account=await register(socket,`Auto${seat}${suffix}`);return{socket,id:account.id,sessionToken:account.sessionToken,seat,seatToken:'' as string,mentalCoins:1000}}));
  const owner=players[0]!;
  const created=await ack<{ok:boolean;code:string;matchId:string;seatToken:string}>(owner.socket,'room:create',{settings:{rounds:3,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:30}});
  assert.equal(created.ok,true);owner.seatToken=created.seatToken;
  for(const player of players.slice(1)){const joined=await ack<{ok:boolean;seatToken:string}>(player.socket,'room:join',{code:created.code});assert.ok(joined.seatToken);player.seatToken=joined.seatToken}
  const waiting=await stateFor(owner.socket,state=>state.status==='waiting'&&state.players.length===4,10_000,'four-player room setup');assert.equal(waiting.players.length,4);
  const startedPromise=stateFor(owner.socket,state=>state.status==='playing',10_000,'game start');owner.socket.emit('game:start',{code:created.code,playerId:owner.id,matchId:created.matchId});
  const started=await startedPromise;assert.ok(started.turnId&&started.turnPlayerId);
  const outOfTurn=players.find(player=>player.id!==started.turnPlayerId)!;
  const setOutOfTurn=await ack<{ok:boolean;enabled?:boolean;error?:string}>(outOfTurn.socket,'game:auto-mode',{code:created.code,playerId:outOfTurn.id,matchId:started.matchId,enabled:true});
  assert.equal(setOutOfTurn.ok,true,setOutOfTurn.error);assert.equal(setOutOfTurn.enabled,true);
  const autoState=await stateFor(owner.socket,state=>state.turnId===started.turnId&&state.players.find(player=>player.id===outOfTurn.id)?.autoPlay===true,10_000,'out-of-turn auto-mode flag');
  assert.equal(autoState.turnPlayerId,started.turnPlayerId,'out-of-turn Auto Mode must not take over the current player');
  const observer=players.find(player=>player.id!==outOfTurn.id)!;
  const offlineStatePromise=stateFor(observer.socket,state=>state.players.find(player=>player.id===outOfTurn.id)?.online===false,10_000,'disconnect state');
  outOfTurn.socket.disconnect();await offlineStatePromise;
  const restoredSocket=await connect(url,outOfTurn.sessionToken);sockets.push(restoredSocket);watch(restoredSocket);outOfTurn.socket=restoredSocket;
  const restoredStatePromise=stateFor(restoredSocket,state=>state.players.find(player=>player.id===outOfTurn.id)?.online===true&&state.players.find(player=>player.id===outOfTurn.id)?.autoPlay===true,10_000,'reconnect state');
  const restored=await ack<{ok:boolean;seatToken:string}>(restoredSocket,'room:join',{code:created.code,seatToken:outOfTurn.seatToken});assert.equal(restored.ok,true);
  const reconnected=await restoredStatePromise;assert.equal(reconnected.players.find(player=>player.id===outOfTurn.id)?.autoPlay,true,'Auto Mode survives reconnect for the same seated player');
  const disabledRestored=await ack<{ok:boolean;enabled?:boolean}>(restoredSocket,'game:auto-mode',{code:created.code,playerId:outOfTurn.id,matchId:started.matchId,enabled:false});assert.equal(disabledRestored.enabled,false);

  const active=players.find(player=>player.id===started.turnPlayerId)!;
  const enabled=await ack<{ok:boolean;enabled?:boolean;error?:string}>(active.socket,'game:auto-mode',{code:created.code,playerId:active.id,matchId:started.matchId,enabled:true});assert.equal(enabled.ok,true,enabled.error);
  const manualReject=onceMatching<string>(active.socket,'room:error',message=>message.includes('Oto mod açık'));
  active.socket.emit('game:action',{code:created.code,playerId:active.id,matchId:started.matchId,turnId:started.turnId,action:'draw'});await manualReject;
  const beforeTurnAdvance=await stateFor(owner.socket,state=>state.turnId!==started.turnId&&state.players.find(player=>player.id===active.id)?.autoPlay===true,12_000,'automated turn completion');
  assert.notEqual(beforeTurnAdvance.turnPlayerId,active.id,'Auto Mode must complete and pass the turn');
  const returnedPlayer=beforeTurnAdvance.players.find(player=>player.id===active.id)!;
  assert.equal(returnedPlayer.seat,active.seat,'the bot uses the existing player seat');assert.equal(returnedPlayer.id,active.id,'the bot uses the existing account/player identity');assert.equal(returnedPlayer.mentalCoins,active.mentalCoins,'Auto Mode cannot alter the account coin balance');
  assert.equal((beforeTurnAdvance.throwsByPlayer[active.id]||[]).length,1,'the automated turn must make one discard under the player identity');

  const currentActor=players.find(player=>player.id===beforeTurnAdvance.turnPlayerId)!;
  const cancelEnabled=await ack<{ok:boolean}>(currentActor.socket,'game:auto-mode',{code:created.code,playerId:currentActor.id,matchId:started.matchId,enabled:true});assert.equal(cancelEnabled.ok,true);
  const cancelDisabled=await ack<{ok:boolean}>(currentActor.socket,'game:auto-mode',{code:created.code,playerId:currentActor.id,matchId:started.matchId,enabled:false});assert.equal(cancelDisabled.ok,true);
  const afterCancel=await stateFor(owner.socket,state=>state.turnId===beforeTurnAdvance.turnId&&state.players.find(player=>player.id===currentActor.id)?.autoPlay===false,2_000,'immediate auto-mode cancellation');
  assert.equal(afterCancel.turnPlayerId,currentActor.id,'Oto Mod kapanınca mevcut tur oyuncuda kalmalı');
  assert.equal((afterCancel.throwsByPlayer[currentActor.id]||[]).length,0,'iptal edilen bot planı manuel hamleden önce taş atmamalı');
  const drawStatePromise=stateFor(currentActor.socket,state=>state.turnId===beforeTurnAdvance.turnId&&state.phase==='discard',3_000,'manual control restored after cancel');
  currentActor.socket.emit('game:action',{code:created.code,playerId:currentActor.id,matchId:started.matchId,turnId:beforeTurnAdvance.turnId,action:'draw'});
  const drawn=await drawStatePromise;const tileId=drawn.hand?.at(-1)?.id;assert.notEqual(tileId,undefined);
  const nextTurnPromise=stateFor(owner.socket,state=>state.turnId!==beforeTurnAdvance.turnId,3_000,'manual turn after Oto Mod cancellation');
  currentActor.socket.emit('game:action',{code:created.code,playerId:currentActor.id,matchId:started.matchId,turnId:beforeTurnAdvance.turnId,action:'discard',tileId});
  const nextTurn=await nextTurnPromise;assert.notEqual(nextTurn.turnPlayerId,currentActor.id);
  await wait(10_250);
  const afterStaleTimerWindow=latestStates.get(owner.socket)!;
  assert.equal(afterStaleTimerWindow.turnId,nextTurn.turnId,'eski Oto Mod zamanlayıcısı sonraki oyuncunun turuna taşmamalı');
  assert.equal((afterStaleTimerWindow.throwsByPlayer[currentActor.id]||[]).length,1,'eski zamanlayıcı aynı turda ikinci bir atış yapmamalı');
});

test('Oto Mod deadline sonuna yakın açıldığında ve kapatma aynı zamanlayıcı anına denk geldiğinde en fazla bir hamle olur',{timeout:45_000},async t=>{
  const port=await unusedPort(),root=process.cwd(),cli=path.join(root,'node_modules','tsx','dist','cli.mjs'),serverFile=path.join(root,'server','index.ts');
  const child:ChildProcessWithoutNullStreams=spawn(process.execPath,[cli,serverFile],{cwd:root,env:{...process.env,PORT:String(port),CLIENT_ORIGIN:'http://localhost:5173',NODE_ENV:'test',DEV_TEST_PANEL:'0'},stdio:['ignore','pipe','pipe']});
  const sockets:Socket[]=[];let output='';child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>output+=String(chunk));
  t.after(async()=>{for(const socket of sockets)socket.close();child.kill();await Promise.race([new Promise<void>(resolve=>child.once('exit',()=>resolve())),wait(3000)])});
  const readyUntil=Date.now()+12_000;while(!output.includes(`Mental Okey server listening on ${port}`)&&Date.now()<readyUntil){if(child.exitCode!==null)throw new Error(`test server exited: ${output}`);await wait(50)}assert.ok(output.includes(`Mental Okey server listening on ${port}`),output);
  const url=`http://127.0.0.1:${port}`,latestStates=new Map<Socket,RoomState>();const watch=(socket:Socket)=>socket.on('room:state',state=>latestStates.set(socket,state as RoomState));
  const stateFor=(socket:Socket,predicate:(state:RoomState)=>boolean,timeoutMs=10_000,label='room state')=>{const latest=latestStates.get(socket);const result=latest&&predicate(latest)?Promise.resolve(latest):roomState(socket,predicate,timeoutMs);return result.catch(error=>{throw new Error(`${label}: ${error instanceof Error?error.message:String(error)}`)})};
  const suffix=Date.now().toString().slice(-5),players=await Promise.all(Array.from({length:4},async(_,seat)=>{const socket=await connect(url);sockets.push(socket);watch(socket);const account=await register(socket,`Race${seat}${suffix}`);return{socket,id:account.id,seat,seatToken:''};}));
  const owner=players[0]!;const created=await ack<{ok:boolean;code:string;matchId:string;seatToken:string}>(owner.socket,'room:create',{settings:{rounds:3,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:30}});assert.equal(created.ok,true);owner.seatToken=created.seatToken;
  for(const player of players.slice(1)){const joined=await ack<{ok:boolean;seatToken:string}>(player.socket,'room:join',{code:created.code});assert.equal(joined.ok,true);player.seatToken=joined.seatToken;}
  const startPromise=stateFor(owner.socket,state=>state.status==='playing');owner.socket.emit('game:start',{code:created.code,playerId:owner.id,matchId:created.matchId});const started=await startPromise;assert.ok(started.turnId&&started.turnDeadlineAt);
  const actor=players.find(player=>player.id===started.turnPlayerId)!;
  const targetRemaining=3_100,waitBeforeEnable=Math.max(0,started.turnDeadlineAt!-Date.now()-targetRemaining);await wait(waitBeforeEnable);
  const beforeEnable=latestStates.get(owner.socket)!;const remaining=beforeEnable.turnDeadlineAt!-Date.now();assert.ok(remaining>2_700&&remaining<3_400,`Oto Mod açılırken yaklaşık 3 saniye kalmalı; kalan ${remaining}ms`);
  const enabled=await ack<{ok:boolean;error?:string}>(actor.socket,'game:auto-mode',{code:created.code,playerId:actor.id,matchId:started.matchId,enabled:true});assert.equal(enabled.ok,true,enabled.error);
  const disableAt=Math.max(0,beforeEnable.turnDeadlineAt!-Date.now()-160);await wait(disableAt);
  const disabled=await ack<{ok:boolean;enabled?:boolean;error?:string}>(actor.socket,'game:auto-mode',{code:created.code,playerId:actor.id,matchId:started.matchId,enabled:false});assert.equal(disabled.ok,true,disabled.error);
  const final=await stateFor(owner.socket,state=>state.players.find(player=>player.id===actor.id)?.autoPlay===false,2_000,'race completion state');
  assert.equal(final.players.find(player=>player.id===actor.id)?.autoPlay,false);
  if(final.turnId!==started.turnId){
    assert.ok(final.serverNow<started.turnDeadlineAt!,'Oto Mod hamlesi süre aşımından önce tamamlanmalı');
    assert.equal((final.throwsByPlayer[actor.id]||[]).length,1,'zamanlayıcı yarışı en fazla bir taş atmalı');
    assert.notEqual(final.turnPlayerId,actor.id,'otomatik hamleden sonra sıra ilerlemeli');
  }else{
    assert.equal((final.throwsByPlayer[actor.id]||[]).length,0,'iptal işlemi hamleden önce geldiyse atış yapılmamalı');
  }
});
