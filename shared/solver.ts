import type { Clue, Coord, PlacedPerson, Puzzle } from './types.js'
import { evaluateClue, getRoomId } from './clue-evaluator.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SolveResult =
  | { status: 'unique'; solution: PlacedPerson[] }
  | { status: 'multiple'; solutions: PlacedPerson[][] }
  | { status: 'none' }

// ─── Multi-cell object constraint helpers ─────────────────────────────────────

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

// For a 2×2 block, two cells are "opposite corners" if they differ in both row and col
function areOppositeCorners(a: Coord, b: Coord): boolean {
  return Math.abs(a.row - b.row) === 1 && Math.abs(a.col - b.col) === 1
}

// ─── Placement validity ───────────────────────────────────────────────────────

function isNonOccupiableCell(coord: Coord, puzzle: Puzzle): boolean {
  return puzzle.objects.some(obj =>
    obj.occupiable === 'non-occupiable' &&
    obj.cells.some(c => c.row === coord.row && c.col === coord.col)
  )
}

function checkMultiCellObjectConstraints(
  coord: Coord,
  assignment: Map<string, Coord>,
  reverseAssignment: Map<string, string>,
  puzzle: Puzzle,
): boolean {
  // Find objects that include this coord
  const objectsHere = puzzle.objects.filter(obj =>
    obj.cells.some(c => c.row === coord.row && c.col === coord.col)
  )

  for (const obj of objectsHere) {
    const occupants = obj.cells
      .map(c => reverseAssignment.get(`${c.row},${c.col}`))
      .filter((id): id is string => id !== undefined)
      // Include the person we're about to place (coord is already in reverseAssignment at call time)

    if (isLinear(obj.cells)) {
      // Max 1 person across all cells
      if (occupants.length > 1) return false
    } else if (is2x2Block(obj.cells)) {
      // Max 2 people, must be in opposite corners
      if (occupants.length > 2) return false
      if (occupants.length === 2) {
        const coords = occupants.map(id => assignment.get(id)!)
        if (!areOppositeCorners(coords[0], coords[1])) return false
      }
    }
  }
  return true
}

// ─── Solver ───────────────────────────────────────────────────────────────────

export function solve(
  puzzle: Puzzle,
  clues: Clue[],
  limit = 2,
): SolveResult {
  const { rows, cols } = puzzle.gridSize
  const personIds = puzzle.people.map(p => p.id)
  const solutions: PlacedPerson[][] = []

  // Track which rows/cols are taken
  const usedRows = new Set<number>()
  const usedCols = new Set<number>()
  const assignment = new Map<string, Coord>()
  const reverseAssignment = new Map<string, string>() // "row,col" -> personId

  function backtrack(personIndex: number): void {
    if (solutions.length >= limit) return

    if (personIndex === personIds.length) {
      // Check all clues are satisfied
      for (const clue of clues) {
        const result = evaluateClue(clue, assignment, puzzle)
        if (result !== 'satisfied') return
      }
      // Validate murder condition
      const victimId = puzzle.people.find(p => p.role === 'victim')?.id
      if (victimId) {
        const victimCoord = assignment.get(victimId)
        if (victimCoord) {
          const victimRoom = getRoomId(victimCoord, puzzle)
          if (victimRoom) {
            const inVictimRoom = [...assignment.entries()].filter(
              ([, c]) => getRoomId(c, puzzle) === victimRoom
            )
            if (inVictimRoom.length !== 2) return
          }
        }
      }
      solutions.push(personIds.map(id => ({ personId: id, coord: assignment.get(id)! })))
      return
    }

    const personId = personIds[personIndex]

    for (let row = 0; row < rows; row++) {
      if (usedRows.has(row)) continue
      for (let col = 0; col < cols; col++) {
        if (usedCols.has(col)) continue

        const coord: Coord = { row, col }
        const key = `${row},${col}`

        // Skip non-occupiable cells
        if (isNonOccupiableCell(coord, puzzle)) continue

        // Place person tentatively
        assignment.set(personId, coord)
        reverseAssignment.set(key, personId)
        usedRows.add(row)
        usedCols.add(col)

        // Check multi-cell object constraints
        const objOk = checkMultiCellObjectConstraints(coord, assignment, reverseAssignment, puzzle)

        if (objOk) {
          // Early pruning: check if any clue is already violated
          let violated = false
          for (const clue of clues) {
            if (evaluateClue(clue, assignment, puzzle) === 'violated') {
              violated = true
              break
            }
          }

          if (!violated) {
            backtrack(personIndex + 1)
            if (solutions.length >= limit) {
              // Undo and return early
              assignment.delete(personId)
              reverseAssignment.delete(key)
              usedRows.delete(row)
              usedCols.delete(col)
              return
            }
          }
        }

        // Undo
        assignment.delete(personId)
        reverseAssignment.delete(key)
        usedRows.delete(row)
        usedCols.delete(col)
      }
    }
  }

  backtrack(0)

  if (solutions.length === 0) return { status: 'none' }
  if (solutions.length === 1) return { status: 'unique', solution: solutions[0] }
  return { status: 'multiple', solutions: solutions.slice(0, 2) }
}
