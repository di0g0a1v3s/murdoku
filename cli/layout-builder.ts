import type { Coord, GridObject, ObjectKind, Room } from '../shared/types.js'
import { OBJECT_OCCUPIABILITY } from '../shared/types.js'
import type { PuzzleTheme } from './llm-client.js'

const GRID_ROWS = 6
const GRID_COLS = 6

// ─── Room partitioning via Voronoi BFS ────────────────────────────────────────

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Simple seeded PRNG (Mulberry32)
function makePrng(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildRooms(theme: PuzzleTheme, seed: number): Room[] {
  const rng = makePrng(seed)
  const numRooms = 6

  // Pick random seed cells (one per room)
  const allCells: Coord[] = []
  for (let r = 0; r < GRID_ROWS; r++)
    for (let c = 0; c < GRID_COLS; c++)
      allCells.push({ row: r, col: c })

  const shuffled = shuffle(allCells, rng)
  const seeds = shuffled.slice(0, numRooms)

  // Voronoi BFS assignment
  const assignment: (number | null)[][] = Array.from({ length: GRID_ROWS }, () =>
    Array(GRID_COLS).fill(null)
  )
  const queue: { coord: Coord; roomIndex: number }[] = []

  seeds.forEach((seed, i) => {
    assignment[seed.row][seed.col] = i
    queue.push({ coord: seed, roomIndex: i })
  })

  const neighbors = (c: Coord): Coord[] =>
    [
      { row: c.row - 1, col: c.col },
      { row: c.row + 1, col: c.col },
      { row: c.row, col: c.col - 1 },
      { row: c.row, col: c.col + 1 },
    ].filter(n => n.row >= 0 && n.row < GRID_ROWS && n.col >= 0 && n.col < GRID_COLS)

  let head = 0
  while (head < queue.length) {
    const { coord, roomIndex } = queue[head++]
    for (const n of shuffle(neighbors(coord), rng)) {
      if (assignment[n.row][n.col] === null) {
        assignment[n.row][n.col] = roomIndex
        queue.push({ coord: n, roomIndex })
      }
    }
  }

  // Build Room objects
  return theme.rooms.map((r, i) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    cells: allCells.filter(c => assignment[c.row][c.col] === i),
  }))
}

// ─── Object placement ─────────────────────────────────────────────────────────

// Objects pool: kind + cell pattern (offsets from anchor)
interface ObjectTemplate {
  kind: ObjectKind
  offsets: Coord[] // relative offsets from anchor cell
}

const OBJECT_TEMPLATES: ObjectTemplate[] = [
  { kind: 'chair', offsets: [{ row: 0, col: 0 }] },
  { kind: 'chair', offsets: [{ row: 0, col: 0 }] },
  { kind: 'plant', offsets: [{ row: 0, col: 0 }] },
  { kind: 'table', offsets: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
  { kind: 'bed', offsets: [{ row: 0, col: 0 }, { row: 1, col: 0 }] },
  { kind: 'bookshelf', offsets: [{ row: 0, col: 0 }] },
  { kind: 'desk', offsets: [{ row: 0, col: 0 }] },
  { kind: 'sofa', offsets: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
  { kind: 'fireplace', offsets: [{ row: 0, col: 0 }] },
  { kind: 'counter', offsets: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
  { kind: 'wardrobe', offsets: [{ row: 0, col: 0 }] },
  { kind: 'toilet', offsets: [{ row: 0, col: 0 }] },
]

function getCellsForTemplate(anchor: Coord, template: ObjectTemplate): Coord[] {
  return template.offsets.map(o => ({ row: anchor.row + o.row, col: anchor.col + o.col }))
}

function cellsInRoom(cells: Coord[], room: Room): boolean {
  return cells.every(c => room.cells.some(rc => rc.row === c.row && rc.col === c.col))
}

function cellsNotOccupied(cells: Coord[], usedCells: Set<string>): boolean {
  return cells.every(c => !usedCells.has(`${c.row},${c.col}`))
}

export interface LayoutResult {
  rooms: Room[]
  objects: GridObject[]
}

export function buildLayout(theme: PuzzleTheme, seed: number): LayoutResult {
  const rng = makePrng(seed + 1000)
  const rooms = buildRooms(theme, seed)

  const objects: GridObject[] = []
  const usedCells = new Set<string>()

  // Place 1-2 objects per room
  for (const room of rooms) {
    const numObjects = Math.floor(rng() * 2) + 1 // 1 or 2
    const shuffledTemplates = shuffle([...OBJECT_TEMPLATES], rng)
    let placed = 0

    for (const template of shuffledTemplates) {
      if (placed >= numObjects) break

      // Try random anchor cells in the room
      const roomCells = shuffle([...room.cells], rng)
      for (const anchor of roomCells) {
        const cells = getCellsForTemplate(anchor, template)
        if (cellsInRoom(cells, room) && cellsNotOccupied(cells, usedCells)) {
          const id = `${template.kind}-${room.id}-${placed + 1}`
          objects.push({
            id,
            kind: template.kind,
            occupiable: OBJECT_OCCUPIABILITY[template.kind],
            cells,
          })
          cells.forEach(c => usedCells.add(`${c.row},${c.col}`))
          placed++
          break
        }
      }
    }
  }

  return { rooms, objects }
}

// ─── Occupiable cell validation ───────────────────────────────────────────────

export function getOccupiableCells(rooms: Room[], objects: GridObject[]): Coord[] {
  const nonOccupiableCells = new Set<string>()
  for (const obj of objects) {
    if (obj.occupiable === 'non-occupiable') {
      obj.cells.forEach(c => nonOccupiableCells.add(`${c.row},${c.col}`))
    }
  }

  const result: Coord[] = []
  for (const room of rooms) {
    for (const cell of room.cells) {
      if (!nonOccupiableCells.has(`${cell.row},${cell.col}`)) {
        result.push(cell)
      }
    }
  }
  return result
}

export function hasEnoughOccupiableCells(
  rooms: Room[],
  objects: GridObject[],
  needed: number,
): boolean {
  const occupiable = getOccupiableCells(rooms, objects)
  // Must have at least one occupiable cell per row and per column
  const rows = new Set(occupiable.map(c => c.row))
  const cols = new Set(occupiable.map(c => c.col))
  return rows.size >= needed && cols.size >= needed
}
