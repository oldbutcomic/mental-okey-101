import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { io as createIo, type Socket } from 'socket.io-client';

type PublicRoom = {
  status: string;
  matchId: string;
  turnId: string | null;
  turnPlayerId: string | null;
  phase: string;
  players: Array<{ id: string; seat: number; online: boolean; score: number; tilesLeft: number; mentalCoins?:number }>;
  hand: Array<{ id: number }>;
  discard: Array<{ id: number }>;
  throwsByPlayer:Record<string,Array<{id:number}>>;
  melds: Array<{ tileIds: number[] }>;
  penaltyHistory: Array<{ points: number; reason: string }>;
  personalNotifications: Array<{ text: string }>;
  [key: string]: unknown;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate an ephemeral port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function onceMatching<T>(socket: Socket, event: string, predicate: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.off(event, listener); };
    const listener = (value: T) => {
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}`)); }, timeoutMs);
    socket.on(event, listener);
  });
}

function ack<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event} acknowledgement`)), timeoutMs);
    socket.emit(event, payload, (response: T) => { clearTimeout(timer); resolve(response); });
  });
}

function ackWithoutPayload<T>(socket: Socket, event: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event} acknowledgement`)), timeoutMs);
    socket.timeout(timeoutMs).emit(event, (error: Error | null, response: T) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function connect(url: string, sessionToken?: string): Promise<Socket> {
  const socket = createIo(url, { autoConnect: false, auth: sessionToken?{sessionToken}:{}, transports: ['websocket'], reconnection: false, timeout: 5000, forceNew: true });
  socket.on('account:session-token',(event:{sessionToken:string})=>{if(typeof event?.sessionToken==='string')socket.auth={sessionToken:event.sessionToken}});
  socket.connect();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Timed out connecting to test server')); }, 7000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); socket.close(); reject(error); });
  });
}

function connectWithOrigin(url: string, origin: string): Promise<Socket> {
  const socket = createIo(url, { autoConnect: false, transports: ['websocket'], reconnection: false, timeout: 5000, forceNew: true, extraHeaders: { Origin: origin } });
  socket.connect();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Timed out connecting with an Origin header')); }, 7000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); socket.close(); reject(error); });
  });
}

function rejectedOriginConnection(url: string, origin: string): Promise<void> {
  const socket = createIo(url, { autoConnect: false, transports: ['websocket'], reconnection: false, timeout: 5000, forceNew: true, extraHeaders: { Origin: origin } });
  socket.connect();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Disallowed Origin unexpectedly connected')); }, 7000);
    socket.once('connect_error', () => { clearTimeout(timer); socket.close(); resolve(); });
    socket.once('connect', () => { clearTimeout(timer); socket.close(); reject(new Error('Disallowed Origin unexpectedly connected')); });
  });
}

async function registerAccount(socket:Socket,username:string):Promise<{id:string;username:string;sessionToken:string;mentalCoins:number}>{
  const result=await ack<{ok:boolean;account?:{id:string;username:string;mentalCoins:number};sessionToken?:string;error?:string}>(socket,'account:register',{username,pin:'481516'});
  assert.equal(result.ok,true,result.error||'Test account registration failed');
  assert.ok(result.account?.id&&result.sessionToken);
  assert.equal(result.account?.mentalCoins,1000,'New accounts receive the welcome coins on registration');
  socket.auth={sessionToken:result.sessionToken};
  const restored=await ack<{ok:boolean;account?:{mentalCoins:number}}>(socket,'account:me',{});
  assert.equal(restored.ok,true);
  assert.equal(restored.account?.mentalCoins,1000,'Session restoration does not repeat the welcome credit');
  return {id:result.account!.id,username:result.account!.username,sessionToken:result.sessionToken!,mentalCoins:result.account!.mentalCoins};
}

function containsSeatTokenField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.keys(value).some(key => /seat.?token/i.test(key))) return true;
  return Object.values(value).some(containsSeatTokenField);
}

function waitForState(socket: Socket, predicate: (state: PublicRoom) => boolean, timeoutMs = 8000): Promise<PublicRoom> {
  return onceMatching(socket, 'room:state', predicate, timeoutMs);
}

test('Socket.IO oda akışında koltuk tokenı, reconnect yarışı ve kişisel hatalı açma cezası doğrulanır', { timeout: 30000 }, async t => {
  const port = await unusedPort();
  const root = process.cwd();
  const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverFile = path.join(root, 'server', 'index.ts');
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [cli, serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: 'http://localhost:5173', NODE_ENV: 'test', DEV_TEST_PANEL: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets: Socket[] = [];
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  t.after(async () => {
    for (const socket of sockets) socket.close();
    child.kill();
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), wait(3000)]);
  });

  const readyDeadline = Date.now() + 12000;
  while (!output.includes(`Mental Okey server listening on ${port}`) && Date.now() < readyDeadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
    await wait(50);
  }
  assert.ok(output.includes(`Mental Okey server listening on ${port}`), `Server did not start:\n${output}`);

  const url = `http://127.0.0.1:${port}`;
  const publicSocketPayloads: unknown[] = [];
  const players = await Promise.all(Array.from({ length: 4 }, async (_, seat) => {
    const socket = await connect(url);
    sockets.push(socket);
    const account=await registerAccount(socket,`Integration ${seat}`);
    socket.onAny((event, ...args) => publicSocketPayloads.push({ event, payload: args }));
    return { socket, id: account.id, name: account.username, sessionToken:account.sessionToken, mentalCoins:account.mentalCoins };
  }));
  const latestStates=new Map<Socket,PublicRoom>();
  for(const player of players)player.socket.on('room:state',state=>latestStates.set(player.socket,state as PublicRoom));
  const stateWhen=(socket:Socket,predicate:(state:PublicRoom)=>boolean)=>{
    const latest=latestStates.get(socket);
    return latest&&predicate(latest)?Promise.resolve(latest):waitForState(socket,predicate);
  };
  const [owner, ...others] = players;
  const sharedAccountSocket=await connect(url);sockets.push(sharedAccountSocket);
  const sharedAccount=await registerAccount(sharedAccountSocket,'Single Session');
  const replacementNotice=onceMatching<unknown>(sharedAccountSocket,'account:session-replaced',()=>true);
  const replacementSocket=await connect(url,sharedAccount.sessionToken);sockets.push(replacementSocket);
  await replacementNotice;
  const recoveredAccount=await ack<{ok:boolean;account?:{id:string}}>(replacementSocket,'account:me',{});
  assert.equal(recoveredAccount.ok,true);
  assert.equal(recoveredAccount.account?.id,sharedAccount.id,'a single account can have only one active control socket');
  const seatTokens=new Map<string,string>();
  const settings = { rounds: 3, mode: 'solo', folding: false, assisted: true, tableColor: 'wood', turnDurationSeconds: 45 };
  const created = await ack<{ ok: boolean; code: string; matchId: string; seatToken: string }>(owner.socket, 'room:create', {settings,playerId:'spoofed-account-id',name:'Spoofed name',avatar:'X'});
  assert.equal(created.ok, true);
  assert.ok(created.seatToken.length >= 32);
  seatTokens.set(owner.id,created.seatToken);
  const code = created.code;
  const matchId = created.matchId;
  const createdState=await waitForState(owner.socket,state=>state.status==='waiting'&&state.players.length===1);
  assert.equal(createdState.players[0]?.id,owner.id,'room identity must come from the authenticated account, not the client payload');
  const pong = await ackWithoutPayload<{ serverTime: number; serverProcessingMs: number }>(owner.socket, 'connection:ping');
  assert.ok(Number.isFinite(pong.serverTime), 'the latency probe must receive a server acknowledgement');
  assert.ok(Number.isFinite(pong.serverProcessingMs) && pong.serverProcessingMs >= 0, 'server handler processing time must be separately measurable');
  const duplicateOwner = await connect(url);
  sockets.push(duplicateOwner);
  const duplicateJoin = await ack<{ ok: boolean; error?: string }>(duplicateOwner, 'room:join', {
    code, playerId: owner.id, name: owner.name, avatar: 'O', seatToken: created.seatToken,
  });
  assert.equal(duplicateJoin.ok, false, 'a second active socket must not claim the same seat even with its seat token');
  assert.match(duplicateJoin.error || '', /hesabınıza giriş/i);
  for (const player of others) {
    const joined = await ack<{ ok: boolean; seatToken:string }>(player.socket, 'room:join', {code});
    assert.equal(joined.ok, true);
    seatTokens.set(player.id,joined.seatToken);
  }
  const fullWaitingState=await stateWhen(owner.socket,state=>state.status==='waiting'&&state.players.length===4);
  for(const player of players)assert.equal(fullWaitingState.players.find(entry=>entry.id===player.id)?.mentalCoins,player.mentalCoins,'public room state must carry each authenticated account balance from the server');

  const startedState = waitForState(owner.socket, state => state.status === 'playing');
  owner.socket.emit('game:start', { code, playerId: owner.id, matchId });
  const started = await startedState;
  const starter=players.find(player=>player.id===started.turnPlayerId);
  assert.ok(starter,'round start must choose one of the seated players');
  const starterSeat=started.players.find(player=>player.id===starter.id)?.seat;
  assert.notEqual(starterSeat,undefined);
  const observer=players.find(player=>player.id!==starter.id)!;
  assert.equal(started.phase, 'discard');
  assert.equal('seatToken' in started, false, 'seat token must never be included in public room state');

  const interactionStates = await Promise.all(players.map(async (player, index) => {
    const target = players[(index + 1) % players.length]!;
    return ack<{ok:boolean;mentalCoins:number;cooldownUntil:number|null;serverNow:number;error?:string}>(player.socket,'interaction:state',{code,matchId,targetPlayerId:target.id});
  }));
  assert.ok(interactionStates.every(result=>result.ok&&result.mentalCoins===1000&&result.cooldownUntil===null),'each seated account receives its own authoritative balance and cooldown');
  const invalidTarget=await ack<{ok:boolean;error?:string}>(owner.socket,'interaction:state',{code,matchId,targetPlayerId:'not-in-this-room'});
  assert.equal(invalidTarget.ok,false,'a player outside the room cannot be selected as an interaction target');
  const receivedNotices=players.map((player,index)=>onceMatching<{targetPlayerId:string;senderPlayerId:string;matchId:string}>(player.socket,'interaction:received',event=>event.matchId===matchId&&event.targetPlayerId===player.id&&event.senderPlayerId===players[(index+players.length-1)%players.length]!.id));
  const interactionResults=await Promise.all(players.map(async(player,index)=>{
    const target=players[(index+1)%players.length]!;
    return ack<{ok:boolean;status:string;mentalCoins:number;cooldownUntil:number|null}>(player.socket,'interaction:send',{
      code,matchId,targetPlayerId:target.id,itemId:'tea',requestId:`integration-gift-${index}-0001`,
    });
  }));
  assert.ok(interactionResults.every(result=>result.ok&&result.status==='purchased'&&result.mentalCoins===975),'four simultaneous distinct account purchases are charged once at the server catalogue price');
  const delivered=await Promise.all(receivedNotices);
  assert.ok(delivered.every(event=>event.targetPlayerId&&event.senderPlayerId&&event.matchId===matchId),'each recipient sees the notice addressed to their own player id');
  const stateAfterInteractions=await stateWhen(owner.socket,state=>state.players.every(player=>player.mentalCoins===975));
  assert.equal(stateAfterInteractions.players.length,4,'updated server balances are published into the room state');
  const retryInteraction=await ack<{ok:boolean;status:string;mentalCoins:number}>(owner.socket,'interaction:send',{
    code,matchId,targetPlayerId:players[1]!.id,itemId:'tea',requestId:'integration-gift-0-0001',
  });
  assert.equal(retryInteraction.status,'duplicate','retrying the same interaction returns the idempotent result even during cooldown');
  assert.equal(retryInteraction.mentalCoins,975);
  const blockedJoke=await ack<{ok:boolean;status:string;mentalCoins:number;error?:string}>(owner.socket,'interaction:send',{
    code,matchId,targetPlayerId:players[1]!.id,itemId:'applause',requestId:'integration-joke-0-0001',
  });
  assert.equal(blockedJoke.status,'cooldown','gift and joke purchases share one per-account cooldown');
  assert.equal(blockedJoke.mentalCoins,975,'blocked interaction does not charge coins');
  const unknownProduct=await ack<{ok:boolean;error?:string}>(owner.socket,'interaction:send',{
    code,matchId,targetPlayerId:players[1]!.id,itemId:'invented-free-gift',requestId:'integration-spoof-0-0001',
  });
  assert.equal(unknownProduct.ok,false,'client cannot submit an item or price outside the server catalogue');

  await stateWhen(starter.socket,state=>state.status==='playing');
  const startedSnapshot = JSON.stringify(latestStates.get(starter.socket));
  const guidanceCandidate = { seriesGroups: [], pairGroups: [], elden: null };
  const ownGuidance = await ack<{ ok: boolean; requestKey: string; turnId: string; active: boolean; canDiscard: boolean; canOpenSeries: boolean; canOpenPairs: boolean }>(starter.socket, 'game:guidance-preview', {
    code, playerId: starter.id, matchId, turnId: started.turnId, requestKey: 'integration-guidance-owner', candidate: guidanceCandidate,
  });
  assert.equal(ownGuidance.ok, true);
  assert.equal(ownGuidance.requestKey, 'integration-guidance-owner');
  assert.equal(ownGuidance.active, true);
  assert.equal(ownGuidance.canDiscard, true);
  assert.equal(ownGuidance.canOpenSeries, false);
  assert.equal(ownGuidance.canOpenPairs, false);
  const wrongTurnGuidance = await ack<{ ok: boolean; active: boolean; canDiscard: boolean; canDrawStock: boolean }>(observer.socket, 'game:guidance-preview', {
    code, playerId: observer.id, matchId, turnId: started.turnId, requestKey: 'integration-guidance-waiting', candidate: guidanceCandidate,
  });
  assert.equal(wrongTurnGuidance.active, false);
  assert.equal(wrongTurnGuidance.canDiscard, false);
  assert.equal(wrongTurnGuidance.canDrawStock, false);
  const staleGuidance = await ack<{ ok: boolean; active: boolean; canDiscard: boolean }>(starter.socket, 'game:guidance-preview', {
    code, playerId: starter.id, matchId, turnId: 'old-guidance-turn', requestKey: 'integration-guidance-stale', candidate: guidanceCandidate,
  });
  assert.equal(staleGuidance.active, false);
  assert.equal(staleGuidance.canDiscard, false);
  const spoofedGuidance = await ack<{ ok: boolean; error?: string }>(observer.socket, 'game:guidance-preview', {
    code, playerId: starter.id, matchId, turnId: started.turnId, requestKey: 'integration-guidance-spoof', candidate: guidanceCandidate,
  });
  assert.equal(spoofedGuidance.ok, false, 'read-only preview still requires the authenticated player session');
  assert.equal(JSON.stringify(latestStates.get(starter.socket)), startedSnapshot, 'read-only guidance preview must not emit or mutate room state');

  const otherStateAfterDisconnect = waitForState(observer.socket, state => state.players.find(player => player.id === starter.id)?.online === false);
  const botTurnPromise=waitForState(observer.socket,state=>state.turnPlayerId!==starter.id&&state.players.find(player=>player.id===starter.id)?.online===false,12_000);
  starter.socket.disconnect();
  const offlineState = await otherStateAfterDisconnect;
  assert.equal(offlineState.turnPlayerId, starter.id);

  const attacker = await connect(url);
  sockets.push(attacker);
  const stolenSeat = await ack<{ ok: boolean; error?: string }>(attacker, 'room:join', {
    code, playerId: starter.id, name: 'Attacker', avatar: 'X',
  });
  assert.equal(stolenSeat.ok, false);
  assert.match(stolenSeat.error || '', /hesabınıza giriş/i);

  const afterBotTurn=await botTurnPromise;
  assert.ok((afterBotTurn.players.find(player=>player.id===starter.id)?.tilesLeft||0)<22,'offline bot must complete the active player\'s turn; an opening may also reduce their hand');
  assert.equal(afterBotTurn.throwsByPlayer[starter.id]?.length,1,'offline bot must discard before passing the turn');
  assert.notEqual(afterBotTurn.turnId,offlineState.turnId);

  const reconnected = await connect(url,starter.sessionToken);
  sockets.push(reconnected);
  starter.socket = reconnected;
  let latestReconnectedState: PublicRoom | undefined;
  reconnected.on('room:state', state => { latestReconnectedState = state as PublicRoom; });
  const restoredStatePromise = waitForState(reconnected, state => state.players.find(player => player.id === starter.id)?.online === true);
  const restored = await ack<{ ok: boolean; seatToken: string }>(reconnected, 'room:join', {code,seatToken:seatTokens.get(starter.id)});
  assert.equal(restored.ok, true);
  assert.equal(restored.seatToken, seatTokens.get(starter.id));
  const restoredState = await restoredStatePromise;
  assert.equal(restoredState.players.find(player=>player.id===starter.id)?.seat,starterSeat,'active-match reconnect preserves the original seat');
  assert.equal(restoredState.players.find(player=>player.id===starter.id)?.mentalCoins,975,'rejoining a seat reloads the account balance after interaction purchases');
  assert.equal(restoredState.turnPlayerId, afterBotTurn.turnPlayerId, 'the completed offline bot action must remain; reconnect must not rewind it');
  await wait(1900);
  assert.equal(latestReconnectedState?.turnPlayerId, afterBotTurn.turnPlayerId, 'online human turn must not be played by a bot');

  const playHumanTurn=async(player:{socket:Socket;id:string})=>{
    const before=await stateWhen(player.socket,state=>state.turnPlayerId===player.id&&state.phase==='draw');
    assert.ok(before.turnId);
    const turnId=before.turnId;
    const drawnPromise=stateWhen(player.socket,state=>state.turnId===turnId&&state.phase==='discard');
    player.socket.emit('game:action',{code,playerId:player.id,matchId,turnId,action:'draw'});
    const drawn=await drawnPromise;
    const tileId=drawn.hand.at(-1)?.id;
    assert.notEqual(tileId,undefined);
    const nextTurnPromise=stateWhen(player.socket,state=>state.turnPlayerId!==player.id);
    player.socket.emit('game:action',{code,playerId:player.id,matchId,turnId,action:'discard',tileId});
    await nextTurnPromise;
  };
  for(let turn=0;turn<3;turn++){
    const current=latestStates.get(observer.socket);
    const actor=current&&players.find(player=>player.id===current.turnPlayerId);
    if(!actor||actor.id===starter.id)break;
    await playHumanTurn(actor);
  }
  const returnedToStarter=await stateWhen(reconnected,state=>state.turnPlayerId===starter.id&&state.phase==='draw');
  assert.equal(returnedToStarter.players.find(player=>player.id===starter.id)?.online,true);
  const p0TurnId=returnedToStarter.turnId;
  assert.ok(p0TurnId);
  const p0DrawnPromise=stateWhen(reconnected,state=>state.turnId===p0TurnId&&state.phase==='discard');
  reconnected.emit('game:action',{code,playerId:starter.id,matchId,turnId:p0TurnId,action:'draw'});
  const p0AfterDraw=await p0DrawnPromise;

  const turnId = p0AfterDraw.turnId;
  assert.ok(turnId);
  const nextPlayer=players.find(player=>player.id!==starter.id)!;
  const p1Before = nextPlayer.socket;
  const wrongTurnError = onceMatching<string>(p1Before, 'room:error', message => /sıranızda/i.test(message));
  p1Before.emit('game:action', { code, playerId: nextPlayer.id, matchId, turnId, requestId: 'wrong-turn', action: 'open', groups: [], pairMode: false });
  await wrongTurnError;

  const ownerPenaltyStatePromise = waitForState(reconnected, state => state.players.find(player => player.id === starter.id)?.score === 101);
  const peerPrivateStatePromise = waitForState(p1Before, state => state.players.find(player => player.id === starter.id)?.score === 101);
  const invalidError = onceMatching<string>(reconnected, 'room:error', message => message.includes('101 ceza'));
  const invalidOpen = { code, playerId: starter.id, matchId, turnId, requestId: 'invalid-open-once', action: 'open', groups: [], pairMode: false };
  reconnected.emit('game:action', invalidOpen);
  const [, ownerPenaltyState, peerPenaltyState] = await Promise.all([invalidError, ownerPenaltyStatePromise, peerPrivateStatePromise]);
  assert.equal(ownerPenaltyState.players.find(player => player.id === starter.id)?.score, 101);
  assert.equal(ownerPenaltyState.hand.length, p0AfterDraw.hand.length, 'invalid opening must retain the current hand regardless of earlier bot openings');
  assert.equal(ownerPenaltyState.penaltyHistory.filter(entry => entry.reason === 'invalid-open').length, 1);
  assert.equal(ownerPenaltyState.personalNotifications.filter(notification=>notification.text.includes('101 ceza')).length, 1);
  assert.equal(peerPenaltyState.personalNotifications.some(notification=>notification.text.includes('101 ceza')), false, 'personal penalties must not be disclosed to other players');
  assert.equal(peerPenaltyState.penaltyHistory.length, 0);
  assert.equal(peerPenaltyState.players.find(player => player.id === nextPlayer.id)?.score, 0, 'a wrong-turn opening request must not penalize its sender');

  const replayError = onceMatching<string>(reconnected, 'room:error', message => message.includes('ikinci kez'));
  reconnected.emit('game:action', invalidOpen);
  await replayError;
  await wait(100);
  assert.equal(ownerPenaltyState.players.find(player => player.id === starter.id)?.score, 101);
  assert.equal(ownerPenaltyState.penaltyHistory.filter(entry => entry.reason === 'invalid-open').length, 1);

  const staleError = onceMatching<string>(reconnected, 'room:error', message => message.includes('önceki turdan'));
  reconnected.emit('game:action', { ...invalidOpen, turnId: 'old-turn-id', requestId: 'stale-open' });
  await staleError;
  assert.equal(ownerPenaltyState.players.find(player => player.id === starter.id)?.score, 101, 'stale-turn rejects must not incur another penalty');
  assert.ok(publicSocketPayloads.every(payload => !containsSeatTokenField(payload)), 'public Socket.IO events must not contain a seat token field');
  assert.ok([...seatTokens.values()].every(token=>!JSON.stringify(publicSocketPayloads).includes(token)), 'private seat token values must not appear in public Socket.IO events');
});

test('sunucu yeniden başlatıldığında bellekte tutulan masalar korunmaz', { timeout: 25000 }, async t => {
  const port = await unusedPort();
  const root = process.cwd();
  const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverFile = path.join(root, 'server', 'index.ts');
  const launch = () => spawn(process.execPath, [cli, serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: 'http://localhost:5173', NODE_ENV: 'test', DEV_TEST_PANEL: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let child: ChildProcessWithoutNullStreams = launch();
  let output = '';
  const collect = (process: ChildProcessWithoutNullStreams) => {
    process.stdout.on('data', chunk => { output += String(chunk); });
    process.stderr.on('data', chunk => { output += String(chunk); });
  };
  collect(child);
  const sockets: Socket[] = [];
  const waitReady = async (process: ChildProcessWithoutNullStreams) => {
    const deadline = Date.now() + 10000;
    while (!output.includes(`Mental Okey server listening on ${port}`) && Date.now() < deadline) {
      if (process.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
      await wait(50);
    }
    assert.ok(output.includes(`Mental Okey server listening on ${port}`), `Server did not start:\n${output}`);
  };
  const stop = async (process: ChildProcessWithoutNullStreams) => {
    if (process.exitCode !== null) return;
    process.kill();
    await Promise.race([new Promise<void>(resolve => process.once('exit', () => resolve())), wait(3000)]);
  };
  t.after(async () => {
    for (const socket of sockets) socket.close();
    await stop(child);
  });

  await waitReady(child);
  const url = `http://127.0.0.1:${port}`;
  const firstSocket = await connect(url);
  sockets.push(firstSocket);
  await registerAccount(firstSocket,'Restart Check');
  const created = await ack<{ ok: boolean; code: string; seatToken: string }>(firstSocket, 'room:create', {
    settings: { rounds: 3, mode: 'solo', folding: false, assisted: true, tableColor: 'wood', turnDurationSeconds: 45 },
  });
  assert.equal(created.ok, true);
  await stop(child);
  output = '';
  child = launch();
  collect(child);
  await waitReady(child);
  const afterRestart = await connect(url);
  sockets.push(afterRestart);
  await registerAccount(afterRestart,'Restart Check');
  const restore = await ack<{ ok: boolean; error?: string }>(afterRestart, 'room:join', {
    code: created.code, playerId: 'restart-check-player', name: 'Restart Check', avatar: 'R', seatToken: created.seatToken,
  });
  assert.equal(restore.ok, false);
  assert.match(restore.error || '', /açık masa bulunamadı/i);
});

test('bekleme odasında reconnect, anında ayrılma, koltuk yeniden kullanımı ve sahip devri güvenlidir', { timeout: 35000 }, async t => {
  const port = await unusedPort();
  const root = process.cwd();
  const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [cli, path.join(root, 'server', 'index.ts')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: 'http://localhost:5173', NODE_ENV: 'test', DEV_TEST_PANEL: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets: Socket[] = [];
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  t.after(async () => {
    for (const socket of sockets) socket.close();
    child.kill();
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), wait(3000)]);
  });

  const readyDeadline = Date.now() + 12000;
  while (!output.includes(`Mental Okey server listening on ${port}`) && Date.now() < readyDeadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
    await wait(50);
  }
  assert.ok(output.includes(`Mental Okey server listening on ${port}`), `Server did not start:\n${output}`);
  const url = `http://127.0.0.1:${port}`;
  const suffix = Date.now().toString().slice(-6);
  const participants = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const socket = await connect(url);
    sockets.push(socket);
    const account = await registerAccount(socket, `Wait${suffix}${index}`);
    return { socket, id: account.id, sessionToken: account.sessionToken, seatToken: '' };
  }));
  const [owner, guest, third, fourth, fifth, sixth] = participants as [typeof participants[number], ...typeof participants[number][]];
  const settings = { rounds: 3, mode: 'solo', folding: false, assisted: true, tableColor: 'wood', turnDurationSeconds: 45 };
  const created = await ack<{ ok: boolean; code: string; matchId: string; seatToken: string }>(owner.socket, 'room:create', { settings });
  assert.equal(created.ok, true);
  const code = created.code;
  const guestJoin = await ack<{ ok: boolean; seatToken: string }>(guest.socket, 'room:join', { code });
  assert.equal(guestJoin.ok, true);
  guest.seatToken = guestJoin.seatToken;
  const initial = await waitForState(owner.socket, state => state.status === 'waiting' && state.players.length === 2);
  assert.deepEqual(initial.players.map(player => player.seat), [0, 1]);

  const waitingOffline = waitForState(owner.socket, state => state.players.find(player => player.id === guest.id)?.online === false);
  guest.socket.disconnect();
  const reserved = await waitingOffline;
  assert.equal(reserved.players.find(player => player.id === guest.id)?.seat, 1, 'a waiting-room disconnect keeps the seat reserved');

  const thirdJoin = await ack<{ ok: boolean; seatToken: string }>(third.socket, 'room:join', { code });
  assert.equal(thirdJoin.ok, true);
  const thirdState = await waitForState(third.socket, state => state.players.length === 3);
  assert.equal(thirdState.players.find(player => player.id === third.id)?.seat, 2, 'the disconnected seat is not assigned to a new player');
  const returnedGuest = await connect(url, guest.sessionToken);
  sockets.push(returnedGuest);
  guest.socket = returnedGuest;
  const duplicateRoom = await ack<{ ok: boolean; error?: string }>(returnedGuest, 'room:create', { settings });
  assert.equal(duplicateRoom.ok, false, 'a waiting seat reservation prevents the same account from taking another room');
  assert.match(duplicateRoom.error || '', /koltuk 60 saniye korunuyor/i);
  const guestRestoredState = waitForState(returnedGuest, state => state.players.find(player => player.id === guest.id)?.online === true);
  const restored = await ack<{ ok: boolean; seatToken: string }>(returnedGuest, 'room:join', { code, seatToken: guest.seatToken });
  assert.equal(restored.ok, true);
  assert.equal(restored.seatToken, guest.seatToken);
  assert.equal((await guestRestoredState).players.find(player => player.id === guest.id)?.seat, 1, 'same account and seat token restore the original seat');

  const afterGuestLeaves = waitForState(owner.socket, state => state.players.length === 2 && !state.players.some(player => player.id === guest.id));
  const left = await ack<{ ok: boolean; error?: string }>(returnedGuest, 'room:leave', { code, playerId: guest.id });
  assert.equal(left.ok, true, left.error);
  await afterGuestLeaves;
  const staleSeat = await ack<{ ok: boolean; error?: string }>(returnedGuest, 'room:join', { code, seatToken: guest.seatToken });
  assert.equal(staleSeat.ok, false, 'a released seat token cannot reclaim a seat');
  assert.match(staleSeat.error || '', /Koltuk süresi doldu/i);

  const fourthJoin = await ack<{ ok: boolean; seatToken: string }>(fourth.socket, 'room:join', { code });
  assert.equal(fourthJoin.ok, true);
  const fourthState = await waitForState(fourth.socket, state => state.players.length === 3);
  assert.equal(fourthState.players.find(player => player.id === fourth.id)?.seat, 1, 'a voluntarily released seat is immediately reusable');

  const afterOwnerLeaves = waitForState(third.socket, state => state.players.length === 2 && !state.players.some(player => player.id === owner.id));
  const ownerLeft = await ack<{ ok: boolean; error?: string }>(owner.socket, 'room:leave', { code, playerId: owner.id });
  assert.equal(ownerLeft.ok, true, ownerLeft.error);
  await afterOwnerLeaves;
  assert.equal((await ack<{ ok: boolean; seatToken: string }>(fifth.socket, 'room:join', { code })).ok, true);
  assert.equal((await ack<{ ok: boolean; seatToken: string }>(sixth.socket, 'room:join', { code })).ok, true);
  const fullState = await waitForState(third.socket, state => state.players.length === 4);
  assert.equal(new Set(fullState.players.map(player => player.seat)).size, 4, 'reused seats remain unique');

  const gameStarted = waitForState(third.socket, state => state.status === 'playing');
  third.socket.emit('game:start', { code, playerId: third.id, matchId: created.matchId });
  const activeState = await gameStarted;
  assert.equal(activeState.players.length, 4, 'the waiting-room owner becomes the first remaining seated player');
  const activeLeave = await ack<{ ok: boolean; error?: string }>(fourth.socket, 'room:leave', { code, playerId: fourth.id });
  assert.equal(activeLeave.ok, false, 'room:leave cannot free a seat after the match starts');
  assert.match(activeLeave.error || '', /Oyun başladıktan sonra koltuk bırakılamaz/i);
  assert.equal(activeState.players.find(player => player.id === fourth.id)?.seat, 1, 'active-match seats are not reassigned');
});

test('sağlık kontrolü, Socket.IO CORS ve davet kodu kapalı beta kayıt akışı tutarlıdır', { timeout: 25000 }, async t => {
  const port = await unusedPort();
  const root = process.cwd();
  const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [cli, path.join(root, 'server', 'index.ts')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: 'https://beta.example', BETA_INVITE_CODE: 'private-test-invite-8f4a', NODE_ENV: 'test', ENABLE_TEST_PANEL: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets: Socket[] = [];
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  t.after(async () => {
    for (const socket of sockets) socket.close();
    child.kill();
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), wait(3000)]);
  });

  const readyDeadline = Date.now() + 12000;
  while (!output.includes(`Mental Okey server listening on ${port}`) && Date.now() < readyDeadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
    await wait(50);
  }
  assert.ok(output.includes(`Mental Okey server listening on ${port}`), `Server did not start:\n${output}`);
  const url = `http://127.0.0.1:${port}`;

  const healthy = await fetch(`${url}/healthz`, { headers: { Origin: 'https://beta.example' } });
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers.get('access-control-allow-origin'), 'https://beta.example');
  assert.deepEqual(await healthy.json(), { status: 'ok' });
  const deniedHealth = await fetch(`${url}/healthz`, { headers: { Origin: 'https://not-beta.example' } });
  assert.equal(deniedHealth.status, 403);
  assert.equal(deniedHealth.headers.get('access-control-allow-origin'), null);
  const noOriginHealth = await fetch(`${url}/healthz`);
  assert.equal(noOriginHealth.status, 200, 'Render health checks without a browser Origin remain allowed');

  const allowedSocket = await connectWithOrigin(url, 'https://beta.example');
  sockets.push(allowedSocket);
  await rejectedOriginConnection(url, 'https://not-beta.example');

  const noCode = await ack<{ ok: boolean; error?: string }>(allowedSocket, 'account:register', { username: 'Invite User', pin: '481516' });
  assert.equal(noCode.ok, false);
  assert.match(noCode.error || '', /Davet kodu geçersiz/i);
  const wrongCode = await ack<{ ok: boolean; error?: string }>(allowedSocket, 'account:register', { username: 'Invite User', pin: '481516', inviteCode: 'wrong-code' });
  assert.equal(wrongCode.ok, false);
  const registered = await ack<{ ok: boolean; account?: { username: string }; error?: string }>(allowedSocket, 'account:register', { username: 'Invite User', pin: '481516', inviteCode: 'private-test-invite-8f4a' });
  assert.equal(registered.ok, true, registered.error);
  const logout = await ack<{ ok: boolean; error?: string }>(allowedSocket, 'account:logout', {});
  assert.equal(logout.ok, true, logout.error);
  const login = await ack<{ ok: boolean; account?: { username: string }; error?: string }>(allowedSocket, 'account:login', { username: 'Invite User', pin: '481516' });
  assert.equal(login.ok, true, login.error);
  assert.equal(login.account?.username, 'Invite User', 'existing account login does not require the beta invite code');
});
