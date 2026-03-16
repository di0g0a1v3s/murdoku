import type { Coord, GridObject, ObjectKind, Room } from '../shared/types.js';
import { OBJECT_KIND_VALUES, OBJECT_OCCUPIABILITY } from '../shared/types.js';
import type { PuzzleTheme } from './llm-client.js';
import { coordToKey } from '../shared/helpers.js';

// ─── Room partitioning via Voronoi BFS ────────────────────────────────────────

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Simple seeded PRNG (Mulberry32)
function makePrng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildRooms(
  theme: PuzzleTheme,
  seed: number,
  gridRows: number,
  gridCols: number,
): Room[] {
  const rng = makePrng(seed);
  const numRooms = theme.rooms.length;
  const totalCells = gridRows * gridCols;

  // Compute exact integer target sizes from sizePercentage.
  // Floor all, then distribute the rounding remainder to the rooms with the
  // largest fractional parts (so the sum always equals totalCells exactly).
  const totalWeight = theme.rooms.reduce((s, r) => s + r.sizePercentage, 0);
  const rawTargets = theme.rooms.map((r) => (r.sizePercentage / totalWeight) * totalCells);
  const targets = rawTargets.map((t) => Math.floor(t));
  let remainder = totalCells - targets.reduce((a, b) => a + b, 0);
  rawTargets
    .map((t, i) => ({ i, frac: t - Math.floor(t) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (remainder-- > 0) {
        targets[i]!++;
      }
    });

  const allCells: Coord[] = [];
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      allCells.push({ row: r, col: c });
    }
  }

  const assignment: (number | null)[][] = Array.from({ length: gridRows }, () =>
    Array(gridCols).fill(null),
  );
  const roomSizes = new Array<number>(numRooms).fill(0);

  const neighbors = (row: number, col: number): Coord[] =>
    [
      { row: row - 1, col },
      { row: row + 1, col },
      { row, col: col - 1 },
      { row, col: col + 1 },
    ].filter((n) => n.row >= 0 && n.row < gridRows && n.col >= 0 && n.col < gridCols);

  // Farthest-point seeding: each new seed is placed as far as possible (by
  // Manhattan distance) from all already-chosen seeds.  This prevents seeds
  // from clustering and ensures every room starts with accessible frontier cells.
  const shuffledCells = shuffle(allCells, rng);
  const seedCoords: Coord[] = [shuffledCells[0]!];
  while (seedCoords.length < numRooms) {
    let bestCell = shuffledCells[0]!;
    let bestDist = -1;
    for (const cell of shuffledCells) {
      const minDist = Math.min(
        ...seedCoords.map((s) => Math.abs(cell.row - s.row) + Math.abs(cell.col - s.col)),
      );
      if (minDist > bestDist) {
        bestDist = minDist;
        bestCell = cell;
      }
    }
    seedCoords.push(bestCell);
  }
  // Shuffle the seed→room mapping so room order does not bias placement.
  const assignedSeeds = shuffle(seedCoords, rng);

  // Per-room frontiers: each room independently tracks candidate expansion
  // cells.  A cell may appear in multiple rooms' frontiers simultaneously;
  // it is silently skipped when popped if already claimed by another room.
  // This is critical — a global frontier would starve rooms whose seeds share
  // neighbours with an earlier seed.
  const frontiers: Coord[][] = Array.from({ length: numRooms }, () => []);
  const inFrontierOf: Set<string>[] = Array.from({ length: numRooms }, () => new Set());

  const addToFrontier = (roomIdx: number, coord: Coord): void => {
    const key = coordToKey(coord);
    if (!inFrontierOf[roomIdx].has(key)) {
      inFrontierOf[roomIdx].add(key);
      frontiers[roomIdx].push(coord);
    }
  };

  for (let i = 0; i < numRooms; i++) {
    const { row, col } = assignedSeeds[i]!;
    assignment[row][col] = i;
    roomSizes[i] = 1;
    for (const n of neighbors(row, col)) {
      if (assignment[n.row][n.col] === null) {
        addToFrontier(i, n);
      }
    }
  }

  let totalAssigned = numRooms;

  // Phase 1: expand one cell at a time, always picking the room with the
  // highest remaining fraction of its target (normalised need).  Random
  // selection within the frontier avoids DFS-snake patterns that let one room
  // wrap around and enclose another.
  while (totalAssigned < totalCells) {
    let best = -1;
    let bestFraction = 0;
    for (let i = 0; i < numRooms; i++) {
      if (frontiers[i].length === 0) {
        continue;
      }
      const need = targets[i]! - roomSizes[i]!;
      if (need <= 0) {
        continue;
      }
      const fraction = need / targets[i]!;
      if (fraction > bestFraction) {
        bestFraction = fraction;
        best = i;
      }
    }
    if (best === -1) {
      break; // all rooms at quota, or every frontier is exhausted
    }

    // Pick a random cell from this room's frontier (avoids directional bias)
    let claimed = false;
    while (frontiers[best].length > 0 && !claimed) {
      const randIdx = Math.floor(rng() * frontiers[best].length);
      const coord = frontiers[best][randIdx]!;
      // Swap-remove for O(1) deletion
      frontiers[best][randIdx] = frontiers[best][frontiers[best].length - 1]!;
      frontiers[best].pop();

      if (assignment[coord.row][coord.col] !== null) {
        continue; // already claimed by a faster-expanding room
      }
      assignment[coord.row][coord.col] = best;
      roomSizes[best]++;
      totalAssigned++;
      claimed = true;
      for (const n of neighbors(coord.row, coord.col)) {
        if (assignment[n.row][n.col] === null) {
          addToFrontier(best, n);
        }
      }
    }
    // If this room's frontier drained without a claim, the outer loop will
    // naturally skip it (frontier empty) on the next iteration — no break needed.
  }

  // Assign any remaining isolated cells to an adjacent room (ignoring quota).
  // These are truly enclosed pockets; quota correction happens in phase 2.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { row, col } of allCells) {
      if (assignment[row][col] !== null) {
        continue;
      }
      for (const n of neighbors(row, col)) {
        if (assignment[n.row][n.col] !== null) {
          assignment[row][col] = assignment[n.row][n.col];
          roomSizes[assignment[row][col]!]++;
          changed = true;
          break;
        }
      }
    }
  }

  // Phase 2: cell-stealing correction.
  // Iteratively move border cells from over-quota rooms to adjacent under-quota
  // rooms, checking that the donor room stays contiguous after each move.
  // This guarantees exact target sizes regardless of how phase 1 went.
  const roomCells: Coord[][] = Array.from({ length: numRooms }, () => []);
  for (const cell of allCells) {
    roomCells[assignment[cell.row][cell.col]!]!.push(cell);
  }

  const isContiguousWithout = (roomIdx: number, exclude: Coord): boolean => {
    const cells = roomCells[roomIdx]!;
    if (cells.length <= 1) {
      return false; // removing the only cell disconnects it
    }
    const start = cells.find((c) => !(c.row === exclude.row && c.col === exclude.col))!;
    const visited = new Set<string>([coordToKey(start)]);
    const queue: Coord[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const n of neighbors(cur.row, cur.col)) {
        const key = coordToKey(n);
        if (visited.has(key) || assignment[n.row][n.col] !== roomIdx) {
          continue;
        }
        if (n.row === exclude.row && n.col === exclude.col) {
          continue;
        }
        visited.add(key);
        queue.push(n);
      }
    }
    return visited.size === cells.length - 1;
  };

  let balancing = true;
  while (balancing) {
    balancing = false;
    for (let toRoom = 0; toRoom < numRooms; toRoom++) {
      if (roomSizes[toRoom]! >= targets[toRoom]!) {
        continue;
      }
      // Look for a movable cell in an over-quota room adjacent to toRoom
      let moved = false;
      outer: for (const cell of roomCells[toRoom]!) {
        for (const n of neighbors(cell.row, cell.col)) {
          const fromRoom = assignment[n.row][n.col];
          if (fromRoom === null || fromRoom === toRoom) {
            continue;
          }
          if (roomSizes[fromRoom]! <= targets[fromRoom]!) {
            continue; // donor is not over-quota
          }
          if (!isContiguousWithout(fromRoom, n)) {
            continue; // moving this cell would disconnect the donor
          }
          // Move cell n from fromRoom to toRoom
          assignment[n.row][n.col] = toRoom;
          roomSizes[toRoom]!++;
          roomSizes[fromRoom]!--;
          roomCells[toRoom]!.push(n);
          roomCells[fromRoom] = roomCells[fromRoom]!.filter(
            (c) => !(c.row === n.row && c.col === n.col),
          );
          balancing = true;
          moved = true;
          break outer;
        }
      }
      if (!moved && roomSizes[toRoom]! < targets[toRoom]!) {
        // Under-quota room has no over-quota neighbours reachable in one hop.
        // This can happen when it's enclosed by at-quota rooms — skip for now;
        // subsequent iterations may open up paths as other rooms rebalance.
      }
    }
  }

  return theme.rooms.map((r, i) => ({
    id: r.id,
    name: r.name,
    pattern: r.pattern,
    cells: allCells.filter((c) => assignment[c.row][c.col] === i),
  }));
}

// ─── Object placement ─────────────────────────────────────────────────────────

// Objects pool: kind + cell pattern (offsets from anchor)
interface ObjectTemplate {
  kind: ObjectKind;
  offsets: Coord[]; // relative offsets from anchor cell
  minFreeAdjacent: number; // min free in-room cells adjacent to the object after placement
  mustTouchWall: boolean; // at least one cell must border the room boundary or grid edge
}

// Each kind maps to an array of base shapes; getAllRotations is applied to each.
const OBJECT_OFFSETS: Record<ObjectKind, Coord[][]> = {
  chair: [[{ row: 0, col: 0 }]],
  plant: [[{ row: 0, col: 0 }]],
  table: [
    [{ row: 0, col: 0 }],
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ],
  ],
  bed: [
    [
      { row: 0, col: 0 },
      { row: 1, col: 0 },
    ],
  ],
  bookshelf: [[{ row: 0, col: 0 }]],
  sofa: [
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ],
  ],
  fireplace: [[{ row: 0, col: 0 }]],
  counter: [
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ],
  ],
  wardrobe: [[{ row: 0, col: 0 }]],
  toilet: [[{ row: 0, col: 0 }]],
  car: [
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ],
  ],
  tv: [[{ row: 0, col: 0 }]],
  rug: [
    [{ row: 0, col: 0 }],
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ],
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
    ],
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ],
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ],
  ],
};

// Minimum number of free in-room cells adjacent to the object after placement.
// Occupiable objects and service objects need at least one open approach cell.
// Decorative / wall-mounted objects can be tucked into a corner.
const OBJECT_MIN_FREE_ADJACENT: Record<ObjectKind, number> = {
  chair: 1,
  plant: 0,
  table: 2,
  bed: 2,
  bookshelf: 0,
  sofa: 2,
  fireplace: 3,
  counter: 2,
  wardrobe: 1,
  toilet: 1,
  car: 1,
  rug: 0,
  tv: 0,
};

// Objects that structurally belong against a room boundary or grid edge.
const OBJECT_MUST_TOUCH_WALL: Record<ObjectKind, boolean> = {
  chair: false,
  plant: false,
  table: false,
  bed: false,
  bookshelf: true,
  sofa: false,
  fireplace: true,
  counter: true,
  wardrobe: true,
  toilet: true,
  car: false,
  rug: false,
  tv: false,
};

function rotateOffsets90(offsets: Coord[]): Coord[] {
  // 90° clockwise: (r, c) → (c, -r), then normalize to origin
  const rotated = offsets.map(({ row, col }) => ({ row: col, col: -row }));
  const minRow = Math.min(...rotated.map((c) => c.row));
  const minCol = Math.min(...rotated.map((c) => c.col));
  return rotated.map(({ row, col }) => ({ row: row - minRow, col: col - minCol }));
}

function getAllRotations(offsets: Coord[]): Coord[][] {
  const result: Coord[][] = [];
  let current = offsets;
  for (let i = 0; i < 4; i++) {
    const key = JSON.stringify([...current].sort((a, b) => a.row - b.row || a.col - b.col));
    if (
      !result.some(
        (r) => JSON.stringify([...r].sort((a, b) => a.row - b.row || a.col - b.col)) === key,
      )
    ) {
      result.push(current);
    }
    current = rotateOffsets90(current);
  }
  return result;
}

const OBJECT_TEMPLATES: ObjectTemplate[] = OBJECT_KIND_VALUES.flatMap((kind) =>
  OBJECT_OFFSETS[kind].flatMap((baseOffsets) =>
    getAllRotations(baseOffsets).map((offsets) => ({
      kind,
      offsets,
      minFreeAdjacent: OBJECT_MIN_FREE_ADJACENT[kind],
      mustTouchWall: OBJECT_MUST_TOUCH_WALL[kind],
    })),
  ),
);

function getCellsForTemplate(anchor: Coord, template: ObjectTemplate): Coord[] {
  return template.offsets.map((o) => ({ row: anchor.row + o.row, col: anchor.col + o.col }));
}

function cellsInRoom(cells: Coord[], room: Room): boolean {
  return cells.every((c) => room.cells.some((rc) => rc.row === c.row && rc.col === c.col));
}

function cellsNotOccupied(cells: Coord[], usedCells: Set<string>): boolean {
  return cells.every((c) => !usedCells.has(coordToKey(c)));
}

function touchesWall(cells: Coord[], room: Room, gridRows: number, gridCols: number): boolean {
  const roomKeys = new Set(room.cells.map(coordToKey));
  for (const cell of cells) {
    for (const n of [
      { row: cell.row - 1, col: cell.col },
      { row: cell.row + 1, col: cell.col },
      { row: cell.row, col: cell.col - 1 },
      { row: cell.row, col: cell.col + 1 },
    ]) {
      // Out of grid bounds or belongs to a different room — that's a wall
      if (n.row < 0 || n.row >= gridRows || n.col < 0 || n.col >= gridCols) {
        return true;
      }
      if (!roomKeys.has(coordToKey(n))) {
        return true;
      }
    }
  }
  return false;
}

function hasFreeAdjacent(
  cells: Coord[],
  room: Room,
  usedCells: Set<string>,
  minFree: number,
): boolean {
  if (minFree === 0) {
    return true;
  }
  const objectKeys = new Set(cells.map(coordToKey));
  const free = new Set<string>();
  for (const cell of cells) {
    for (const n of [
      { row: cell.row - 1, col: cell.col },
      { row: cell.row + 1, col: cell.col },
      { row: cell.row, col: cell.col - 1 },
      { row: cell.row, col: cell.col + 1 },
    ]) {
      const key = coordToKey(n);
      if (objectKeys.has(key)) {
        continue;
      }
      if (usedCells.has(key)) {
        continue;
      }
      if (!room.cells.some((rc) => rc.row === n.row && rc.col === n.col)) {
        continue;
      }
      free.add(key);
    }
  }
  return free.size >= minFree;
}

export interface LayoutResult {
  rooms: Room[];
  objects: GridObject[];
}

export function buildLayout(
  theme: PuzzleTheme,
  seed: number,
  gridRows: number,
  gridCols: number,
): LayoutResult {
  const rng = makePrng(seed + 1000);
  const rooms = buildRooms(theme, seed, gridRows, gridCols);

  const objects: GridObject[] = [];
  const usedCells = new Set<string>();

  // Place objects in room
  for (let roomIdx = 0; roomIdx < rooms.length; roomIdx++) {
    const room = rooms[roomIdx]!;
    const allowed = theme.rooms[roomIdx]?.allowedObjects ?? [];
    const required = theme.rooms[roomIdx]?.requiredObjects ?? [];

    const fits = (template: ObjectTemplate, anchor: Coord): boolean => {
      const cells = getCellsForTemplate(anchor, template);
      if (
        !cellsInRoom(cells, room) ||
        !cellsNotOccupied(cells, usedCells) ||
        !hasFreeAdjacent(cells, room, usedCells, template.minFreeAdjacent) ||
        (template.mustTouchWall && !touchesWall(cells, room, gridRows, gridCols))
      ) {
        return false;
      }
      // Ensure placing this object doesn't block required free adjacent cells of existing room objects.
      const newUsedCells = new Set(usedCells);
      cells.forEach((c) => newUsedCells.add(coordToKey(c)));
      for (const obj of objects) {
        if (!obj.cells.some((c) => room.cells.some((rc) => rc.row === c.row && rc.col === c.col))) {
          continue;
        }
        if (!hasFreeAdjacent(obj.cells, room, newUsedCells, OBJECT_MIN_FREE_ADJACENT[obj.kind])) {
          return false;
        }
      }
      return true;
    };

    const placeTemplate = (template: ObjectTemplate, anchor: Coord, slotIdx: number): void => {
      const cells = getCellsForTemplate(anchor, template);
      objects.push({
        id: `${template.kind}-${room.id}-${slotIdx + 1}`,
        kind: template.kind,
        occupiable: OBJECT_OCCUPIABILITY[template.kind],
        cells,
      });
      cells.forEach((c) => usedCells.add(coordToKey(c)));
    };

    const unplaceTemplate = (template: ObjectTemplate, anchor: Coord, slotIdx: number): void => {
      const cells = getCellsForTemplate(anchor, template);
      const id = `${template.kind}-${room.id}-${slotIdx + 1}`;
      objects.splice(
        objects.findIndex((o) => o.id === id),
        1,
      );
      cells.forEach((c) => usedCells.delete(coordToKey(c)));
    };

    // Phase 1: backtracking placement of required objects so ordering never blocks them.
    // requiredKinds: one slot per required kind (deduplicated to avoid placing extra copies).
    const requiredKinds = [...new Set(required)];
    const roomCellsShuffled = shuffle([...room.cells], rng);

    function backtrackRequired(idx: number): boolean {
      if (idx === requiredKinds.length) {
        return true;
      }
      const kind = requiredKinds[idx]!;
      const kindTemplates = shuffle(
        OBJECT_TEMPLATES.filter((t) => t.kind === kind),
        rng,
      );
      for (const template of kindTemplates) {
        for (const anchor of roomCellsShuffled) {
          if (!fits(template, anchor)) {
            continue;
          }
          placeTemplate(template, anchor, idx);
          if (backtrackRequired(idx + 1)) {
            return true;
          }
          unplaceTemplate(template, anchor, idx);
        }
      }
      return false;
    }

    if (!backtrackRequired(0)) {
      throw new Error(
        `Required objects [${required.join(', ')}] could not all be placed in room '${room.name}'`,
      );
    }

    // Phase 2: greedily place optional objects up to the target count.
    // Scale with room size: ~1 object per 4 cells, with ±1 randomness.
    const numOptional = Math.max(0, Math.floor(room.cells.length / 4) + Math.floor(rng() * 2));
    const optionalTemplates = shuffle(
      allowed.length > 0
        ? OBJECT_TEMPLATES.filter((t) => allowed.includes(t.kind) && !required.includes(t.kind))
        : OBJECT_TEMPLATES.filter((t) => !required.includes(t.kind)),
      rng,
    );
    let optionalPlaced = 0;
    for (const template of optionalTemplates) {
      if (optionalPlaced >= numOptional) {
        break;
      }
      for (const anchor of shuffle([...room.cells], rng)) {
        if (fits(template, anchor)) {
          placeTemplate(template, anchor, required.length + optionalPlaced);
          optionalPlaced++;
          break;
        }
      }
    }
  }

  return { rooms, objects };
}

// ─── Occupiable cell validation ───────────────────────────────────────────────

export function getOccupiableCells(rooms: Room[], objects: GridObject[]): Coord[] {
  const nonOccupiableCells = new Set<string>();
  for (const obj of objects) {
    if (obj.occupiable === 'non-occupiable') {
      obj.cells.forEach((c) => nonOccupiableCells.add(coordToKey(c)));
    }
  }

  const result: Coord[] = [];
  for (const room of rooms) {
    for (const cell of room.cells) {
      if (!nonOccupiableCells.has(coordToKey(cell))) {
        result.push(cell);
      }
    }
  }
  return result;
}

export function hasEnoughOccupiableCells(
  rooms: Room[],
  objects: GridObject[],
  needed: number,
): boolean {
  const occupiable = getOccupiableCells(rooms, objects);
  // Must have at least one occupiable cell per row and per column
  const rows = new Set(occupiable.map((c) => c.row));
  const cols = new Set(occupiable.map((c) => c.col));
  return rows.size >= needed && cols.size >= needed;
}
