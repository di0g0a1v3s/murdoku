import type { Coord, GridObject, Person, PlacedPerson } from '../shared/types.js';
import type { LayoutResult } from './layout-builder.js';
import { coordToKey, keyToCoord } from '../shared/helpers.js';

// ─── Latin-square backtracking placer ────────────────────────────────────────
// Finds a valid Latin-square placement for all N people (1/row, 1/col, no
// non-occupiable cells) where the victim's room has exactly 2 people.
// Exhaustively searches all Latin-square placements; returns null only if
// no valid placement exists for this layout.

function isNonOccupiable(coord: Coord, objects: GridObject[]): boolean {
  const key = coordToKey(coord);
  return objects.some(
    (obj) => obj.occupiable === 'non-occupiable' && obj.cells.some((c) => coordToKey(c) === key),
  );
}

// Pseudo-random shuffle using simple LCG
function lcgShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface PlacerResult {
  placements: PlacedPerson[];
  murdererId: string;
  victimId: string;
  murderRoom: string;
}

export function placePeople(
  people: Person[],
  layout: LayoutResult,
  gridRows: number,
  gridCols: number,
  seed: number,
): PlacerResult | null {
  const { rooms, objects } = layout;

  const victimId = people.find((p) => p.role === 'victim')!.id;

  // Build O(1) coord→roomId lookup
  const coordToRoomId = new Map<string, string>();
  for (const room of rooms) {
    for (const cell of room.cells) {
      coordToRoomId.set(coordToKey(cell), room.id);
    }
  }

  const occupiedCells = new Set<string>();
  const usedRows = new Set<number>();
  const usedCols = new Set<number>();

  const allCells: Coord[] = [];
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      if (!isNonOccupiable({ row: r, col: c }, objects)) {
        allCells.push({ row: r, col: c });
      }
    }
  }

  const candidates = lcgShuffle(allCells, seed);
  const shuffledRooms = lcgShuffle(rooms, seed);

  function backtrack(): boolean {
    if (occupiedCells.size === people.length) {
      // Murder condition: victim's room must have exactly 2 people
      return shuffledRooms.some(
        (room) =>
          [...occupiedCells].filter((cell) => coordToRoomId.get(cell) === room.id).length === 2,
      );
    }

    for (const coord of candidates) {
      const cellKey = coordToKey(coord);
      if (occupiedCells.has(cellKey)) {
        continue;
      }
      if (usedRows.has(coord.row) || usedCols.has(coord.col)) {
        continue;
      }
      if (!coordToRoomId.has(cellKey)) {
        continue;
      }

      occupiedCells.add(cellKey);
      usedRows.add(coord.row);
      usedCols.add(coord.col);

      if (backtrack()) {
        return true;
      }

      occupiedCells.delete(cellKey);
      usedRows.delete(coord.row);
      usedCols.delete(coord.col);
    }
    return false;
  }

  if (!backtrack()) {
    return null;
  }

  const murderRoom = shuffledRooms.find(
    (room) => [...occupiedCells].filter((cell) => coordToRoomId.get(cell) === room.id).length === 2,
  );
  const [victimPosition, murderedPosition] = [...occupiedCells].filter(
    (cell) => coordToRoomId.get(cell) === murderRoom!.id,
  );

  // Pick murderer at random
  const murderer = lcgShuffle(
    people.filter((p) => p.role === 'suspect'),
    seed,
  )[0];

  const notGuiltySuspects = people.filter((p) => p.role === 'suspect' && p.id != murderer.id);
  const notGuiltySuspectsPositions = [...occupiedCells].filter(
    (c) => c !== victimPosition && c !== murderedPosition,
  );
  const placements: PlacedPerson[] = notGuiltySuspects.map((p, i) => ({
    personId: p.id,
    coord: keyToCoord(notGuiltySuspectsPositions[i]),
  }));
  placements.push({
    personId: murderer.id,
    coord: keyToCoord(murderedPosition),
  });
  placements.push({
    personId: victimId,
    coord: keyToCoord(victimPosition),
  });

  return { placements, murdererId: murderer.id, victimId, murderRoom: murderRoom!.id };
}
