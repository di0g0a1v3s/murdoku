// ─── Coordinates ─────────────────────────────────────────────────────────────

export interface Coord {
  row: number;
  col: number;
}

// ─── Grid Objects ─────────────────────────────────────────────────────────────

export type ObjectKind =
  | 'chair'
  | 'bed'
  | 'sofa'
  | 'toilet'
  | 'table'
  | 'plant'
  | 'bookshelf'
  | 'counter'
  | 'wardrobe'
  | 'fireplace'

export type Occupiability = 'occupiable' | 'non-occupiable'

export interface GridObject {
  id: string
  kind: ObjectKind
  occupiable: Occupiability
  cells: Coord[]
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

export interface Room {
  id: string
  name: string
  cells: Coord[]
  color: string // CSS hex color for background tint
}

// ─── People ───────────────────────────────────────────────────────────────────

export interface Person {
  id: string
  name: string
  role: 'victim' | 'suspect'
  avatarEmoji?: string
}

// ─── Clues ────────────────────────────────────────────────────────────────────

export type Direction = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW'

export type Clue =
  | { kind: 'person-direction'; personA: string; direction: Direction; personB: string; text: string }
  | { kind: 'person-distance'; personA: string; direction: Direction; personB: string; distance: number; axis: 'row' | 'col'; text: string }
  | { kind: 'person-beside-object'; person: string; objectKind: ObjectKind; text: string }
  | { kind: 'person-on-object'; person: string; objectKind: ObjectKind; text: string }
  | { kind: 'person-in-room'; person: string; roomId: string; text: string }
  | { kind: 'persons-same-room'; personA: string; personB: string; text: string }
  | { kind: 'person-alone-in-room'; person: string; roomId: string; text: string }
  | { kind: 'room-population'; roomId: string; count: number; text: string }
  | { kind: 'object-occupancy'; objectKind: ObjectKind; count: number; text: string }
  | { kind: 'person-not-in-room'; person: string; roomId: string; text: string }
  | { kind: 'persons-not-same-room'; personA: string; personB: string; text: string }

// ─── Solution ─────────────────────────────────────────────────────────────────

export interface PlacedPerson {
  personId: string
  coord: Coord
}

export interface Solution {
  placements: PlacedPerson[]
  murdererId: string
  victimId: string
  murderRoom: string
}

// ─── Full Puzzle ──────────────────────────────────────────────────────────────

export interface Puzzle {
  id: string
  title: string
  subtitle?: string
  gridSize: { rows: number; cols: number }
  rooms: Room[]
  objects: GridObject[]
  people: Person[]
  clues: Clue[]
  suspectSummaries: { personId: string; text: string }[]
  solution: Solution
  generatedAt: string
}

// ─── Puzzle Collection ────────────────────────────────────────────────────────

export interface PuzzleCollection {
  version: string
  puzzles: Puzzle[]
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
}

export const OBJECT_EMOJI: Record<ObjectKind, string> = {
  chair: '🪑',
  bed: '🛏️',
  sofa: '🛋️',
  toilet: '🚽',
  table: '🍽️',
  plant: '🪴',
  bookshelf: '📚',
  counter: '🔲',
  wardrobe: '🚪',
  fireplace: '🔥',
}
