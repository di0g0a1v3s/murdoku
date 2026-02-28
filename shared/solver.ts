import type { Clue, Coord, PlacedPerson, Puzzle } from './types.js'
import { evaluateClue, getRoomId } from './clue-evaluator.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SolveResult =
  | { status: 'unique'; solution: PlacedPerson[] }
  | { status: 'multiple'; solutions: PlacedPerson[][] }
  | { status: 'none' }

// ─── Placement validity ───────────────────────────────────────────────────────

function isNonOccupiableCell(coord: Coord, puzzle: Puzzle): boolean {
  return puzzle.objects.some(obj =>
    obj.occupiable === 'non-occupiable' &&
    obj.cells.some(c => c.row === coord.row && c.col === coord.col)
  )
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

        // Skip non-occupiable cells
        if (isNonOccupiableCell(coord, puzzle)) continue

        // Place person tentatively
        assignment.set(personId, coord)
        usedRows.add(row)
        usedCols.add(col)

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
            assignment.delete(personId)
            usedRows.delete(row)
            usedCols.delete(col)
            return
          }
        }

        // Undo
        assignment.delete(personId)
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
