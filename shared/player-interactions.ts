/**
 * Draft-only catalogue for the first interaction UI pass.
 * Names, prices and copy are proposals and must be reviewed before they are
 * treated as the final Mental Okey catalogue.
 */
export type PlayerInteractionKind = 'gift' | 'joke';

export type PlayerInteractionItem = {
  id: string;
  kind: PlayerInteractionKind;
  name: string;
  description: string;
  icon: string;
  price: number;
  receivedText: string;
};

export const PLAYER_INTERACTION_CATALOG_STATUS = 'draft' as const;
export const PLAYER_INTERACTION_COOLDOWN_MS = 30_000;

export const PLAYER_INTERACTION_CATALOG: readonly PlayerInteractionItem[] = [
  { id: 'tea', kind: 'gift', name: 'Çay ikram et', description: 'Masaya sıcak bir çay gönder.', icon: '🍵', price: 25, receivedText: 'sana çay ikram etti.' },
  { id: 'coffee', kind: 'gift', name: 'Kahve ikram et', description: 'Kısa bir kahve molası.', icon: '☕', price: 50, receivedText: 'sana kahve ikram etti.' },
  { id: 'baklava', kind: 'gift', name: 'Baklava ikram et', description: 'Tatlı bir masa jesti.', icon: '🍰', price: 100, receivedText: 'sana tatlı ikram etti.' },
  { id: 'applause', kind: 'joke', name: 'Alkış gönder', description: 'Kısa ve zararsız bir alkış bildirimi.', icon: '👏', price: 25, receivedText: 'sana alkış gönderdi.' },
  { id: 'confetti', kind: 'joke', name: 'Mini konfeti', description: 'Profilinde kısa süreli bir kutlama bildirimi.', icon: '🎉', price: 50, receivedText: 'sana mini konfeti gönderdi.' },
  { id: 'surprise', kind: 'joke', name: 'Şaşkın yüz', description: 'Küçük bir sürpriz tepkisi gönder.', icon: '😲', price: 75, receivedText: 'sana şaşkın bir tepki gönderdi.' },
];

export function findPlayerInteractionItem(id: unknown): PlayerInteractionItem | undefined {
  return typeof id === 'string' ? PLAYER_INTERACTION_CATALOG.find(item => item.id === id) : undefined;
}
