import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { DevOpeningPreparationKind, DevTestInventory, DevTestTilePreview } from '../server/dev-test-panel';
import './dev-test-panel.css';

type Props = { socket: Socket; roomCode: string; playerId: string; matchId: string; onOwnTileSelectionChange: (tileId: number | null) => void };
type Notice = { kind: 'error' | 'success'; text: string };
type SourceKind = 'stock' | 'player';

const colorLabels: Record<NonNullable<DevTestTilePreview['color']>, string> = { red: 'Kırmızı', blue: 'Mavi', black: 'Siyah', yellow: 'Sarı' };
const previewLabel = (tile: DevTestTilePreview) => `${tile.realOkey ? 'Gerçek okey' : tile.fakeJoker ? 'Sahte okey' : `${colorLabels[tile.color||'black']} ${tile.number??'?'}`} · #${tile.id}`;

export default function DevTestPanel({ socket, roomCode, playerId, matchId, onOwnTileSelectionChange }: Props) {
  const [open, setOpen] = useState(false);
  const [sourceKind, setSourceKind] = useState<SourceKind>('stock');
  const [sourcePlayerId, setSourcePlayerId] = useState('');
  const [sourceTileId, setSourceTileId] = useState<number | null>(null);
  const [ownTileId, setOwnTileId] = useState<number | null>(null);
  const [inventory, setInventory] = useState<DevTestInventory | null>(null);
  const [openingTargetId, setOpeningTargetId] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const receiveInventory = (next: DevTestInventory | undefined) => { if (next) setInventory(next); };
  const refreshInventory = (keepNotice = false) => {
    socket.emit('dev-test:inventory', { code: roomCode, playerId, matchId }, (result: { ok: boolean; error?: string; inventory?: DevTestInventory }) => {
      if (result.ok) { receiveInventory(result.inventory); if (!keepNotice) setNotice(null); }
      else setNotice({ kind: 'error', text: result.error || 'Test stoğu okunamadı' });
    });
  };

  useEffect(() => { if (open) refreshInventory(); }, [open, socket, roomCode, playerId, matchId]);
  useEffect(() => () => onOwnTileSelectionChange(null), [onOwnTileSelectionChange]);

  const sourcePlayers = inventory?.otherPlayers || [];
  const sourcePlayer = sourcePlayers.find(player => player.playerId === sourcePlayerId) || sourcePlayers[0];
  const sourceTiles = useMemo(() => sourceKind === 'stock' ? inventory?.stockTiles || [] : sourcePlayer?.tiles || [], [inventory, sourceKind, sourcePlayer]);
  const ownTiles = inventory?.ownHand || [];
  const openingPlayers = inventory?.players || [];
  const selectedSourceTile = sourceTiles.find(tile => tile.id === sourceTileId) || null;
  const selectedOwnTile = ownTiles.find(tile => tile.id === ownTileId) || null;

  useEffect(() => {
    if (sourceKind === 'player' && sourcePlayers.length && !sourcePlayers.some(player => player.playerId === sourcePlayerId)) setSourcePlayerId(sourcePlayers[0].playerId);
    if (!sourceTiles.some(tile => tile.id === sourceTileId)) setSourceTileId(sourceTiles[0]?.id ?? null);
    if (!ownTiles.some(tile => tile.id === ownTileId)) {
      const nextId = ownTiles[0]?.id ?? null;
      setOwnTileId(nextId);
      onOwnTileSelectionChange(nextId);
    }
  }, [sourceKind, sourcePlayerId, sourcePlayers, sourceTiles, sourceTileId, ownTiles, ownTileId, onOwnTileSelectionChange]);

  useEffect(() => {
    if (openingPlayers.length && !openingPlayers.some(player => player.playerId === openingTargetId)) {
      setOpeningTargetId(openingPlayers.find(player => !player.opened)?.playerId || openingPlayers[0].playerId);
    }
  }, [openingPlayers, openingTargetId]);

  const swap = () => {
    if (busy || sourceTileId===null || ownTileId===null || !selectedSourceTile || !selectedOwnTile) return;
    const source = sourceKind === 'stock' ? { kind: 'stock' as const, tileId: sourceTileId } : { kind: 'player' as const, playerId: sourcePlayer?.playerId || sourcePlayerId, tileId: sourceTileId };
    if (source.kind === 'player' && !source.playerId) return;
    setBusy(true);
    socket.emit('dev-test:swap', { code: roomCode, playerId, matchId, source, ownTileId }, (result: { ok: boolean; error?: string; message?: string; inventory?: DevTestInventory }) => {
      setBusy(false);
      if (!result.ok) { setNotice({ kind: 'error', text: result.error || 'Taş takası reddedildi' }); refreshInventory(true); return; }
      receiveInventory(result.inventory);
      setSourceTileId(null);
      setOwnTileId(null);
      onOwnTileSelectionChange(null);
      setNotice({ kind: 'success', text: result.message || 'Taş takası tamamlandı' });
    });
  };

  const emptyHand = () => {
    if (busy || !window.confirm('Istakanızdaki taşlar stok alanına geri taşınsın mı?')) return;
    setBusy(true);
    socket.emit('dev-test:apply', { code: roomCode, playerId, matchId, selections: [], clearHand: true }, (result: { ok: boolean; error?: string; message?: string; inventory?: DevTestInventory }) => {
      setBusy(false);
      if (!result.ok) { setNotice({ kind: 'error', text: result.error || 'Istaka boşaltılamadı' }); refreshInventory(true); return; }
      receiveInventory(result.inventory);
      setOwnTileId(null);
      onOwnTileSelectionChange(null);
      setNotice({ kind: 'success', text: result.message || 'Istaka boşaltıldı' });
    });
  };

  const openPlayer = (kind: DevOpeningPreparationKind) => {
    if (busy || !openingTargetId) return;
    const target = openingPlayers.find(player => player.playerId === openingTargetId);
    if (!target || target.opened) return;
    if (!window.confirm(`İlk kullanımda dört oyuncunun elleri mevcut gerçek desteden test için hazırlanır; ardından ${target.name} normal sunucu kurallarıyla ${kind === 'series' ? 'seri' : 'çift'} açar. Sonraki oyuncular için bu işlemi tekrarlayın. Devam edilsin mi?`)) return;
    setBusy(true);
    socket.emit('dev-test:open-player', { code: roomCode, playerId, matchId, targetPlayerId: openingTargetId, kind }, (result: { ok: boolean; error?: string; message?: string; inventory?: DevTestInventory }) => {
      setBusy(false);
      if (!result.ok) { setNotice({ kind: 'error', text: result.error || 'Oyuncu açılamadı' }); refreshInventory(true); return; }
      receiveInventory(result.inventory);
      const nextPlayer = result.inventory?.players.find(player => !player.opened);
      if (nextPlayer) setOpeningTargetId(nextPlayer.playerId);
      setOwnTileId(null);
      setSourceTileId(null);
      onOwnTileSelectionChange(null);
      setNotice({ kind: 'success', text: `${result.message || 'Test açılışı tamamlandı'}. Fiziksel taş kimlikleri ve oyun süresi korundu.` });
    });
  };

  return <aside className={`dev-test-panel${open ? ' is-open' : ''}`} aria-label="Geçici geliştirme test paneli">
    <button type="button" className="dev-test-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="dev-test-indicator" aria-hidden="true">✦</span>{open ? 'TEST PANELİ −' : 'TEST PANELİ +'}
    </button>
    {open && <div className="dev-test-body">
      <div className="dev-test-heading"><b>TEST PANELİ</b><span>Stok: {inventory?.stockCount ?? '…'}</span><button type="button" onClick={()=>refreshInventory(true)}>Güncelle</button></div>
      <section className="dev-test-prepare" aria-label="Açılış ve 9.3 işleme testi hazırlığı">
        <b className="dev-test-section-title">AÇILIŞ / 9.3 İŞLEME TESTİ</b>
        <p>Oyuncu seçip gerçek taşlarla seri veya çift açtırın. İlk kullanımda dört el stok ve oyuncu taşlarıyla hazırlanır; açılış normal sunucu kurallarından geçer. Katlamalı modda koltukları sırayla açtırın.</p>
        <label className="dev-test-field">Açacak oyuncu
          <select value={openingTargetId} onChange={event => setOpeningTargetId(event.target.value)} disabled={!openingPlayers.length}>
            {openingPlayers.map(player => <option value={player.playerId} key={player.playerId} disabled={player.opened}>{String.fromCharCode(65 + player.seat)} · {player.name}{player.opened ? ' · Açtı' : ''}</option>)}
          </select>
        </label>
        <div className="dev-test-prepare-actions">
          <button type="button" disabled={busy || !openingTargetId || openingPlayers.find(player => player.playerId === openingTargetId)?.opened} onClick={() => openPlayer('series')}>{busy ? 'Hazırlanıyor…' : 'Seçili oyuncuya SERİ açtır'}</button>
          <button type="button" disabled={busy || !openingTargetId || openingPlayers.find(player => player.playerId === openingTargetId)?.opened} onClick={() => openPlayer('pairs')}>{busy ? 'Hazırlanıyor…' : 'Seçili oyuncuya ÇİFT açtır'}</button>
        </div>
      </section>
      <section className="dev-test-swap" aria-label="Taş takası">
        <b className="dev-test-section-title">TAŞ TAKASI</b>
        <label className="dev-test-field">Kaynak alanı
          <select value={sourceKind} onChange={event => { setSourceKind(event.target.value as SourceKind); setSourceTileId(null); }}>
            <option value="stock">Orta kapalı stok</option><option value="player">Başka oyuncunun ıstakası</option>
          </select>
        </label>
        {sourceKind==='player'&&<label className="dev-test-field">Oyuncu
          <select value={sourcePlayer?.playerId||''} onChange={event=>{setSourcePlayerId(event.target.value);setSourceTileId(null)}}>
            {sourcePlayers.map(player=><option value={player.playerId} key={player.playerId}>{player.name} · {player.tiles.length} taş</option>)}
          </select>
        </label>}
        <label className="dev-test-field">Kaynak taşı
          <select value={sourceTileId===null?'':String(sourceTileId)} onChange={event=>setSourceTileId(event.target.value?Number(event.target.value):null)} disabled={!sourceTiles.length}>
            {sourceTiles.map(tile=><option value={tile.id} key={tile.id}>{previewLabel(tile)}</option>)}
          </select>
        </label>
        <label className="dev-test-field">Benim ıstakamdan karşılık
          <select value={ownTileId===null?'':String(ownTileId)} onChange={event=>{const tileId=event.target.value?Number(event.target.value):null;setOwnTileId(tileId);onOwnTileSelectionChange(tileId)}} disabled={!ownTiles.length}>
            {ownTiles.map(tile=><option value={tile.id} key={tile.id}>{previewLabel(tile)}</option>)}
          </select>
        </label>
        <div className="dev-test-swap-summary" aria-live="polite">
          <div><b>Seçilen kaynak</b><span>{selectedSourceTile?previewLabel(selectedSourceTile):'Kaynak taşı seçin'}</span></div>
          <div><b>Benim taşım</b><span>{selectedOwnTile?previewLabel(selectedOwnTile):'Karşılık taşı seçin'}</span></div>
          <small>Benim taşım kaynağın yerine, kaynak taşı da ıstakamdaki taşın yerine geçer.</small>
        </div>
        <button type="button" className="dev-test-apply" disabled={busy||!selectedSourceTile||!selectedOwnTile} onClick={swap}>{busy?'İşleniyor…':'TAKASI ONAYLA'}</button>
      </section>
      <button type="button" className="dev-test-empty" disabled={busy||!ownTiles.length} onClick={emptyHand}>Istakamı tamamen boşalt</button>
      {notice && <p className={`dev-test-notice is-${notice.kind}`} role="status">{notice.text}</p>}
    </div>}
  </aside>;
}
