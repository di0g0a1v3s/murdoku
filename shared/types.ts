export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}

// ─── Coordinates ─────────────────────────────────────────────────────────────

export interface Coord {
  row: number;
  col: number;
}

// ─── Grid Objects ─────────────────────────────────────────────────────────────

export const OBJECT_KIND_VALUES = [
  'chair',
  'bed',
  'sofa',
  'toilet',
  'table',
  'plant',
  'bookshelf',
  'counter',
  'wardrobe',
  'fireplace',
  'car',
  'rug',
  'tv',
] as const;
export type ObjectKind = (typeof OBJECT_KIND_VALUES)[number];

export type Occupiability = 'occupiable' | 'non-occupiable';

export interface GridObject {
  id: string;
  kind: ObjectKind;
  occupiable: Occupiability;
  cells: Coord[];
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

export type RoomPattern =
  | { kind: 'solid'; color: string }
  | { kind: 'striped'; colorA: string; colorB: string }
  | { kind: 'checkered'; colorA: string; colorB: string };

export interface Room {
  id: string;
  name: string;
  cells: Coord[];
  pattern: RoomPattern;
}

// ─── People ───────────────────────────────────────────────────────────────────

export interface Person {
  id: string;
  name: string;
  role: 'victim' | 'suspect';
  avatarEmoji?: string;
}

// ─── Clues ────────────────────────────────────────────────────────────────────

export type Direction = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';

export type Clue =
  | {
      kind: 'person-direction';
      personA: string;
      direction: Direction;
      personB: string;
    }
  | {
      kind: 'person-distance';
      personA: string;
      direction: Direction;
      personB: string;
      distance: number;
      axis: 'row' | 'col';
    }
  | { kind: 'person-beside-object'; person: string; objectKind: ObjectKind }
  | { kind: 'person-on-object'; person: string; objectKind: ObjectKind }
  | { kind: 'person-in-room'; person: string; roomId: string }
  | { kind: 'persons-same-room'; personA: string; personB: string }
  | { kind: 'person-alone-in-room'; person: string; roomId: string }
  | { kind: 'room-population'; roomId: string; count: number }
  | { kind: 'object-occupancy'; objectKind: ObjectKind; count: number }
  | { kind: 'person-not-in-room'; person: string; roomId: string }
  | { kind: 'persons-not-same-room'; personA: string; personB: string }
  | { kind: 'person-in-room-with'; person: string; count: number }
  | { kind: 'person-in-row'; person: string; row: number }
  | { kind: 'person-in-col'; person: string; col: number }
  | { kind: 'person-in-corner'; person: string }
  | { kind: 'person-in-room-corner'; person: string }
  | { kind: 'person-sole-occupant'; person: string; objectKind: ObjectKind }
  | { kind: 'empty-rooms'; count: number };

export type StoredClue = Clue & { text: string };

// ─── Solution ─────────────────────────────────────────────────────────────────

export interface PlacedPerson {
  personId: string;
  coord: Coord;
}

export interface Solution {
  placements: PlacedPerson[];
  murdererId: string;
  victimId: string;
  murderRoom: string;
}

// ─── Puzzle (base — used by solver, evaluator, generator) ────────────────────

export interface Puzzle {
  gridSize: { rows: number; cols: number };
  rooms: Room[];
  objects: GridObject[];
  people: Person[];
  clues: Clue[];
  solution: Solution;
}

// ─── Full Puzzle (stored in JSON, used by the frontend) ──────────────────────

export type PuzzleDifficulty = 'easy' | 'easy+' | 'medium' | 'medium+' | 'hard' | 'hard+';

export interface FullPuzzle extends Puzzle {
  clues: StoredClue[];
  id: string;
  title: string;
  subtitle?: string;
  difficulty: PuzzleDifficulty;
  suspectSummaries: { personId: string; text: string }[];
  generatedAt: string;
}

// ─── Puzzle Collection ────────────────────────────────────────────────────────

export interface PuzzleCollection {
  version: string;
  puzzles: FullPuzzle[];
}

// ─── Clue Helpers ─────────────────────────────────────────────────────────────

export function getCluePersonId(clue: Clue): string | null {
  switch (clue.kind) {
    case 'person-direction':
    case 'person-distance':
    case 'persons-same-room':
    case 'persons-not-same-room':
      return clue.personA;
    case 'person-beside-object':
    case 'person-on-object':
    case 'person-in-room':
    case 'person-alone-in-room':
    case 'person-not-in-room':
    case 'person-in-room-with':
    case 'person-in-row':
    case 'person-in-col':
    case 'person-in-corner':
    case 'person-in-room-corner':
    case 'person-sole-occupant':
      return clue.person;
    case 'room-population':
    case 'object-occupancy':
    case 'empty-rooms':
      return null;
    default:
      return assertNever(clue);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const OBJECT_OCCUPIABILITY: Record<ObjectKind, Occupiability> = {
  chair: 'occupiable',
  bed: 'occupiable',
  sofa: 'occupiable',
  toilet: 'occupiable',
  table: 'non-occupiable',
  plant: 'non-occupiable',
  bookshelf: 'non-occupiable',
  counter: 'non-occupiable',
  wardrobe: 'non-occupiable',
  fireplace: 'non-occupiable',
  car: 'occupiable',
  rug: 'occupiable',
  tv: 'non-occupiable',
};
