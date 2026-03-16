import {
  VALID_DIRECTIONS,
  type Clue,
  type Direction,
  type ObjectKind,
  type PlacedPerson,
  type Puzzle,
  type Room,
} from '../shared/types.js';
import {
  getObjectsAdjacentInRoom,
  getObjectsAtCoord,
  directionFromAToB,
} from '../shared/clue-evaluator.js';
import { coordToKey, isRoomCornerCell } from '../shared/helpers.js';

export interface DerivableFact {
  description: string;
  clue: Clue;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pairs<T>(arr: T[]): [T, T][] {
  const result: [T, T][] = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      result.push([arr[i]!, arr[j]!]);
    }
  }
  return result;
}

const DIRECTION_LABEL: Record<string, string> = {
  N: 'north',
  S: 'south',
  E: 'east',
  W: 'west',
  NE: 'northeast',
  NW: 'northwest',
  SE: 'southeast',
  SW: 'southwest',
};

// ─── Sub-generators ───────────────────────────────────────────────────────────

function generatePersonFacts(
  placement: PlacedPerson,
  puzzle: Puzzle,
  coordToRoom: Map<string, Room>,
): DerivableFact[] {
  const facts: DerivableFact[] = [];
  const { personId, coord } = placement;
  const name = puzzle.people.find((p) => p.id === personId)?.name ?? personId;
  const room = coordToRoom.get(coordToKey(coord));
  if (!room) {
    return facts;
  }

  // Room membership
  facts.push({
    description: `${name} is in the ${room.name}`,
    clue: { kind: 'person-in-room', person: personId, roomId: room.id },
  });

  // Row and column position (1-indexed for display)
  facts.push({
    description: `${name} is in row ${coord.row + 1}`,
    clue: { kind: 'person-in-row', person: personId, row: coord.row },
  });
  facts.push({
    description: `${name} is in column ${coord.col + 1}`,
    clue: { kind: 'person-in-col', person: personId, col: coord.col },
  });

  // Grid corner position
  const { rows, cols } = puzzle.gridSize;
  if ((coord.row === 0 || coord.row === rows - 1) && (coord.col === 0 || coord.col === cols - 1)) {
    facts.push({
      description: `${name} is in a corner of the grid`,
      clue: { kind: 'person-in-corner', person: personId },
    });
  }

  // Room corner position (two perpendicular walls)
  const roomCellKeys = new Set(room.cells.map(coordToKey));
  const isWall = (nr: number, nc: number) =>
    nr < 0 || nr >= rows || nc < 0 || nc >= cols || !roomCellKeys.has(`${nr},${nc}`);
  if (isRoomCornerCell(coord, isWall)) {
    facts.push({
      description: `${name} is in a corner of the ${room.name}`,
      clue: { kind: 'person-in-room-corner', person: personId, roomId: room.id },
    });
  }

  // Object at cell (occupied)
  for (const obj of getObjectsAtCoord(coord, puzzle)) {
    if (obj.occupiable === 'occupiable') {
      facts.push({
        description: `${name} is on/at a ${obj.kind}`,
        clue: { kind: 'person-on-object', person: personId, objectKind: obj.kind },
      });
    }
  }

  // Adjacent objects (same room, deduplicated by kind)
  const seenKinds = new Set<string>();
  for (const obj of getObjectsAdjacentInRoom(coord, puzzle)) {
    if (!seenKinds.has(obj.kind)) {
      seenKinds.add(obj.kind);
      facts.push({
        description: `${name} is beside a ${obj.kind}`,
        clue: { kind: 'person-beside-object', person: personId, objectKind: obj.kind },
      });
    }
  }

  return facts;
}

function generatePairwiseFacts(
  pA: PlacedPerson,
  pB: PlacedPerson,
  puzzle: Puzzle,
  coordToRoom: Map<string, Room>,
): DerivableFact[] {
  const facts: DerivableFact[] = [];
  const nameA = puzzle.people.find((p) => p.id === pA.personId)?.name ?? pA.personId;
  const nameB = puzzle.people.find((p) => p.id === pB.personId)?.name ?? pB.personId;
  const cA = pA.coord;
  const cB = pB.coord;

  // Directional (general diagonal/cardinal)
  const dirArelB = directionFromAToB(cB, cA);
  if (dirArelB && VALID_DIRECTIONS.includes(dirArelB)) {
    facts.push({
      description: `${nameA} is ${DIRECTION_LABEL[dirArelB] ?? dirArelB} of ${nameB}`,
      clue: {
        kind: 'person-direction',
        personA: pA.personId,
        direction: dirArelB,
        personB: pB.personId,
      },
    });
  }
  const dirBrelA = directionFromAToB(cA, cB);
  if (dirBrelA && VALID_DIRECTIONS.includes(dirBrelA)) {
    facts.push({
      description: `${nameB} is ${DIRECTION_LABEL[dirBrelA] ?? dirBrelA} of ${nameA}`,
      clue: {
        kind: 'person-direction',
        personA: pB.personId,
        direction: dirBrelA,
        personB: pA.personId,
      },
    });
  }

  // Cardinal row direction (N/S)
  if (cA.row < cB.row) {
    facts.push({
      description: `${nameA} is north of ${nameB}`,
      clue: {
        kind: 'person-direction',
        personA: pA.personId,
        direction: 'N',
        personB: pB.personId,
      },
    });
    facts.push({
      description: `${nameB} is south of ${nameA}`,
      clue: {
        kind: 'person-direction',
        personA: pB.personId,
        direction: 'S',
        personB: pA.personId,
      },
    });
  } else {
    facts.push({
      description: `${nameA} is south of ${nameB}`,
      clue: {
        kind: 'person-direction',
        personA: pA.personId,
        direction: 'S',
        personB: pB.personId,
      },
    });
    facts.push({
      description: `${nameB} is north of ${nameA}`,
      clue: {
        kind: 'person-direction',
        personA: pB.personId,
        direction: 'N',
        personB: pA.personId,
      },
    });
  }

  // Cardinal column direction (E/W)
  if (cA.col > cB.col) {
    facts.push({
      description: `${nameA} is east of ${nameB}`,
      clue: {
        kind: 'person-direction',
        personA: pA.personId,
        direction: 'E',
        personB: pB.personId,
      },
    });
    facts.push({
      description: `${nameB} is west of ${nameA}`,
      clue: {
        kind: 'person-direction',
        personA: pB.personId,
        direction: 'W',
        personB: pA.personId,
      },
    });
  } else {
    facts.push({
      description: `${nameA} is west of ${nameB}`,
      clue: {
        kind: 'person-direction',
        personA: pA.personId,
        direction: 'W',
        personB: pB.personId,
      },
    });
    facts.push({
      description: `${nameB} is east of ${nameA}`,
      clue: {
        kind: 'person-direction',
        personA: pB.personId,
        direction: 'E',
        personB: pA.personId,
      },
    });
  }

  // Column distance (E/W)
  const colDiff = cA.col - cB.col;
  if (colDiff !== 0) {
    const dir: Direction = colDiff > 0 ? 'E' : 'W';
    facts.push({
      description: `${nameA} is exactly ${Math.abs(colDiff)} column(s) ${dir === 'E' ? 'east' : 'west'} of ${nameB}`,
      clue: {
        kind: 'person-distance',
        personA: pA.personId,
        direction: dir,
        personB: pB.personId,
        distance: Math.abs(colDiff),
        axis: 'col',
      },
    });
  }

  // Row distance (N/S)
  const rowDiff = cA.row - cB.row;
  if (rowDiff !== 0) {
    const dir: Direction = rowDiff > 0 ? 'S' : 'N';
    facts.push({
      description: `${nameA} is exactly ${Math.abs(rowDiff)} row(s) ${dir === 'S' ? 'south' : 'north'} of ${nameB}`,
      clue: {
        kind: 'person-distance',
        personA: pA.personId,
        direction: dir,
        personB: pB.personId,
        distance: Math.abs(rowDiff),
        axis: 'row',
      },
    });
  }

  // Same room / not same room
  const roomA = coordToRoom.get(coordToKey(cA));
  const roomB = coordToRoom.get(coordToKey(cB));
  if (roomA && roomB) {
    if (roomA.id === roomB.id) {
      facts.push({
        description: `${nameA} and ${nameB} are in the same room`,
        clue: { kind: 'persons-same-room', personA: pA.personId, personB: pB.personId },
      });
    } else {
      facts.push({
        description: `${nameA} and ${nameB} are NOT in the same room`,
        clue: { kind: 'persons-not-same-room', personA: pA.personId, personB: pB.personId },
      });
      facts.push({
        description: `${nameA} is NOT in the ${roomB.name}`,
        clue: { kind: 'person-not-in-room', person: pA.personId, roomId: roomB.id },
      });
      facts.push({
        description: `${nameB} is NOT in the ${roomA.name}`,
        clue: { kind: 'person-not-in-room', person: pB.personId, roomId: roomA.id },
      });
    }
  }

  return facts;
}

function generateRoomFacts(
  puzzle: Puzzle,
  placements: PlacedPerson[],
  coordToRoom: Map<string, Room>,
): DerivableFact[] {
  const facts: DerivableFact[] = [];
  const personName = (id: string) => puzzle.people.find((p) => p.id === id)?.name ?? id;

  for (const room of puzzle.rooms) {
    const inRoom = placements.filter((p) => coordToRoom.get(coordToKey(p.coord))?.id === room.id);
    const count = inRoom.length;
    if (count === 0) {
      continue;
    }
    facts.push({
      description: `The ${room.name} has exactly ${count} person(s)`,
      clue: { kind: 'room-population', roomId: room.id, count },
    });
    if (count === 1) {
      facts.push({
        description: `${personName(inRoom[0]!.personId)} is alone in the ${room.name}`,
        clue: { kind: 'person-alone-in-room', person: inRoom[0]!.personId, roomId: room.id },
      });
    }
    for (const p of inRoom) {
      const otherCount = count - 1;
      facts.push({
        description: `${personName(p.personId)} is in a room with exactly ${otherCount} other ${otherCount === 1 ? 'person' : 'people'}`,
        clue: { kind: 'person-in-room-with', person: p.personId, count: otherCount },
      });
    }
  }

  // Empty rooms
  const occupiedRoomIds = new Set(
    placements.map((p) => coordToRoom.get(coordToKey(p.coord))?.id).filter(Boolean),
  );
  const emptyCount = puzzle.rooms.filter((r) => !occupiedRoomIds.has(r.id)).length;
  if (emptyCount > 0) {
    facts.push({
      description: `Exactly ${emptyCount} room(s) are empty`,
      clue: { kind: 'empty-rooms', count: emptyCount },
    });
  }

  return facts;
}

function generateObjectFacts(puzzle: Puzzle, placements: PlacedPerson[]): DerivableFact[] {
  const facts: DerivableFact[] = [];
  const personName = (id: string) => puzzle.people.find((p) => p.id === id)?.name ?? id;
  const placementKeySet = new Set(placements.map((p) => coordToKey(p.coord)));

  // Sole-occupant facts
  for (const placement of placements) {
    const { personId, coord } = placement;
    for (const obj of getObjectsAtCoord(coord, puzzle)) {
      if (obj.occupiable !== 'occupiable') {
        continue;
      }
      const othersOnSameKind = placements.some((other) => {
        if (other.personId === personId) {
          return false;
        }
        return getObjectsAtCoord(other.coord, puzzle).some(
          (o) => o.kind === obj.kind && o.occupiable === 'occupiable',
        );
      });
      if (!othersOnSameKind) {
        facts.push({
          description: `${personName(personId)} is the only person on a ${obj.kind}`,
          clue: { kind: 'person-sole-occupant', person: personId, objectKind: obj.kind },
        });
      }
    }
  }

  // Object occupancy counts
  const kindGroups = new Map<ObjectKind, { total: number; occupied: number }>();
  for (const obj of puzzle.objects) {
    if (!kindGroups.has(obj.kind)) {
      kindGroups.set(obj.kind, { total: 0, occupied: 0 });
    }
    const group = kindGroups.get(obj.kind)!;
    group.total++;
    if (obj.occupiable === 'occupiable') {
      if (obj.cells.some((c) => placementKeySet.has(coordToKey(c)))) {
        group.occupied++;
      }
    }
  }
  for (const [kind, { occupied }] of kindGroups) {
    if (occupied > 0) {
      facts.push({
        description: `Exactly ${occupied} ${kind}(s) are occupied`,
        clue: { kind: 'object-occupancy', objectKind: kind, count: occupied },
      });
    }
  }

  return facts;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function computeAllFacts(puzzle: Puzzle, placements: PlacedPerson[]): DerivableFact[] {
  // Build coord→room map once for all sub-generators
  const coordToRoom = new Map<string, Room>();
  for (const room of puzzle.rooms) {
    for (const cell of room.cells) {
      coordToRoom.set(coordToKey(cell), room);
    }
  }

  const facts: DerivableFact[] = [
    ...placements.flatMap((p) => generatePersonFacts(p, puzzle, coordToRoom)),
    ...pairs(placements).flatMap(([pA, pB]) => generatePairwiseFacts(pA, pB, puzzle, coordToRoom)),
    ...generateRoomFacts(puzzle, placements, coordToRoom),
    ...generateObjectFacts(puzzle, placements),
  ];

  // Deduplicate by clue JSON
  const seen = new Set<string>();
  return facts.filter((f) => {
    const key = JSON.stringify(f.clue);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
