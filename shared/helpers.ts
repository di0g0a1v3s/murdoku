import type { Coord } from './types.js';

// ─── Coordinate key helpers ───────────────────────────────────────────────────
//
// Canonical "row,col" string key used throughout solvers, evaluators, generators,
// and layout builders. Centralised here so the format has a single source of
// truth.

export function coordToKey(coord: Coord): string {
  return `${coord.row},${coord.col}`;
}

export function keyToCoord(key: string): Coord {
  const [row, col] = key.split(',').map(Number);
  return { row: row!, col: col! };
}

// ─── Room corner detection ────────────────────────────────────────────────────
//
// A cell is a "room corner" when it has two perpendicular room walls: i.e. at
// least one pair of (north/south) + (east/west) neighbours that are outside
// the room (or outside the grid entirely).
//
// `isWallFn(nr, nc)` should return true when (nr, nc) is not inside the same
// room as the cell being tested.

export function isRoomCornerCell(
  coord: Coord,
  isWallFn: (nr: number, nc: number) => boolean,
): boolean {
  const { row: r, col: c } = coord;
  return (
    (isWallFn(r - 1, c) && isWallFn(r, c - 1)) ||
    (isWallFn(r - 1, c) && isWallFn(r, c + 1)) ||
    (isWallFn(r + 1, c) && isWallFn(r, c - 1)) ||
    (isWallFn(r + 1, c) && isWallFn(r, c + 1))
  );
}
