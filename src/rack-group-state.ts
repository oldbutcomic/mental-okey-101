export type RackGroupPoint = { x: number; y: number };

export type DismissedRackGroup = {
  id: string;
  tileIds: number[];
  positions: Record<number, RackGroupPoint>;
};

export function rackGroupId(tileIds: number[]): string {
  return `rack-group-${[...tileIds].sort((a, b) => a - b).join('-')}`;
}

export function dismissRackGroup(
  dismissed: DismissedRackGroup[],
  tileIds: number[],
  positions: Record<number, RackGroupPoint>,
): DismissedRackGroup[] {
  const id = rackGroupId(tileIds);
  if (dismissed.some((group) => group.id === id)) return dismissed;

  const snapshot: Record<number, RackGroupPoint> = {};
  for (const tileId of tileIds) {
    const position = positions[tileId];
    if (!position) return dismissed;
    snapshot[tileId] = { ...position };
  }

  return [...dismissed, { id, tileIds: [...tileIds], positions: snapshot }];
}

export function retainDismissedRackGroupsAtSamePositions(
  dismissed: DismissedRackGroup[],
  positions: Record<number, RackGroupPoint>,
): DismissedRackGroup[] {
  const retained = dismissed.filter((group) =>
    group.tileIds.every((tileId) => {
      const original = group.positions[tileId];
      const current = positions[tileId];
      return !!original && !!current && original.x === current.x && original.y === current.y;
    }),
  );
  return retained.length === dismissed.length ? dismissed : retained;
}

export function filterDismissedRackGroups<T extends { id: string }>(
  groups: T[],
  dismissed: DismissedRackGroup[],
): T[] {
  if (!dismissed.length) return groups;
  const dismissedIds = new Set(dismissed.map((group) => group.id));
  return groups.filter((group) => !dismissedIds.has(group.id));
}
