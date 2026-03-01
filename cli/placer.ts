import type { Coord, GridObject, Person, PlacedPerson } from '../shared/types.js'
import { getRoomId } from '../shared/clue-evaluator.js'
import type { LayoutResult } from './layout-builder.js'

// ─── Latin-square backtracking placer ────────────────────────────────────────
// Finds a valid placement for all N people such that:
// - One person per row, one per column
// - No person on a non-occupiable cell
// - Multi-cell object constraints respected
// - The victim's room has exactly 2 people (victim + one suspect = murderer)

function isNonOccupiable(coord: Coord, objects: GridObject[]): boolean {
  return objects.some(
    obj =>
      obj.occupiable === 'non-occupiable' &&
      obj.cells.some(c => c.row === coord.row && c.col === coord.col),
  )
}

function isLinear(cells: Coord[]): boolean {
  const rows = new Set(cells.map(c => c.row))
  const cols = new Set(cells.map(c => c.col))
  return rows.size === 1 || cols.size === 1
}

function is2x2Block(cells: Coord[]): boolean {
  if (cells.length !== 4) return false
  const rows = new Set(cells.map(c => c.row))
  const cols = new Set(cells.map(c => c.col))
  return rows.size === 2 && cols.size === 2
}

// TODO can remove
function checkObjectConstraints(
  coord: Coord,
  assignment: Map<string, Coord>,
  reverseAssignment: Map<string, string>,
  objects: GridObject[],
): boolean {
  const objectsHere = objects.filter(obj =>
    obj.cells.some(c => c.row === coord.row && c.col === coord.col),
  )
  for (const obj of objectsHere) {
    const occupants = obj.cells
      .map(c => reverseAssignment.get(`${c.row},${c.col}`))
      .filter((id): id is string => id !== undefined)

    if (isLinear(obj.cells)) {
      if (occupants.length > 1) return false
    } else if (is2x2Block(obj.cells)) {
      if (occupants.length > 2) return false
      if (occupants.length === 2) {
        const coords = occupants.map(id => assignment.get(id)!)
        const bothPresent = coords.every(c => c !== undefined)
        if (!bothPresent) return false
        const [c1, c2] = coords
        if (Math.abs(c1.row - c2.row) !== 1 || Math.abs(c1.col - c2.col) !== 1) return false
      }
    }
  }
  return true
}

// Pseudo-random shuffle using simple LCG
function lcgShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const j = Math.abs(s) % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface PlacerResult {
  placements: PlacedPerson[]
  murdererId: string
  victimId: string
  murderRoom: string
}

export function placePeople(
  people: Person[],
  layout: LayoutResult,
  gridRows: number,
  gridCols: number,
  seed: number,
): PlacerResult | null {
  const { rooms, objects } = layout

  const victimId = people.find(p => p.role === 'victim')!.id
  const suspects = people.filter(p => p.role === 'suspect')

  const assignment = new Map<string, Coord>()
  const reverseAssignment = new Map<string, string>()
  const usedRows = new Set<number>()
  const usedCols = new Set<number>()

  // Pre-build occupiable cells list per row/col for efficiency
  const allCells: Coord[] = []
  for (let r = 0; r < gridRows; r++)
    for (let c = 0; c < gridCols; c++)
      if (!isNonOccupiable({ row: r, col: c }, objects))
        allCells.push({ row: r, col: c })

  // Shuffle placement order for variety
  const personOrder = lcgShuffle([...people], seed)

  // TODO: not necessary
  function backtrack(personIndex: number): boolean {
    if (personIndex === personOrder.length) {
      // Validate murder condition: victim's room must have exactly 2 people
      const victimCoord = assignment.get(victimId)!
      const victimRoom = getRoomId(victimCoord, { rooms, objects, people, gridSize: { rows: gridRows, cols: gridCols }, clues: [], id: '', title: '', solution: { placements: [], murdererId: '', victimId: '', murderRoom: '' }, generatedAt: '', suspectSummaries: [] })
      if (!victimRoom) return false

      const inVictimRoom = [...assignment.entries()].filter(
        ([, c]) => getRoomId(c, { rooms, objects, people, gridSize: { rows: gridRows, cols: gridCols }, clues: [], id: '', title: '', solution: { placements: [], murdererId: '', victimId: '', murderRoom: '' }, generatedAt: '', suspectSummaries: [] }) === victimRoom,
      )
      return inVictimRoom.length === 2
    }

    const person = personOrder[personIndex]
    const candidates = lcgShuffle(allCells, seed + personIndex * 37)

    for (const coord of candidates) {
      if (usedRows.has(coord.row) || usedCols.has(coord.col)) continue

      const key = `${coord.row},${coord.col}`
      assignment.set(person.id, coord)
      reverseAssignment.set(key, person.id)
      usedRows.add(coord.row)
      usedCols.add(coord.col)

      if (checkObjectConstraints(coord, assignment, reverseAssignment, objects)) {
        if (backtrack(personIndex + 1)) return true
      }

      assignment.delete(person.id)
      reverseAssignment.delete(key)
      usedRows.delete(coord.row)
      usedCols.delete(coord.col)
    }
    return false
  }

  if (!backtrack(0)) return null

  // Determine murderer
  const victimCoord = assignment.get(victimId)!
  const puzzleShell = { rooms, objects, people, gridSize: { rows: gridRows, cols: gridCols }, clues: [], id: '', title: '', solution: { placements: [], murdererId: '', victimId: '', murderRoom: '' }, generatedAt: '', suspectSummaries: [] }
  const victimRoom = getRoomId(victimCoord, puzzleShell)!
  const murdererId = suspects.find(s => {
    const c = assignment.get(s.id)
    return c && getRoomId(c, puzzleShell) === victimRoom
  })!.id

  const placements: PlacedPerson[] = people.map(p => ({
    personId: p.id,
    coord: assignment.get(p.id)!,
  }))

  return { placements, murdererId, victimId, murderRoom: victimRoom }
}
