import { assertNever, type Clue, type Coord, type PlacedPerson, type Puzzle } from './types.js'
import { evaluateClue, getRoomId } from './clue-evaluator.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SolveResult =
  | { status: 'unique'; solution: PlacedPerson[] }
  | { status: 'multiple'; solutions: PlacedPerson[][] }
  | { status: 'none' }

// ─── Solver ───────────────────────────────────────────────────────────────────

export function solve(
  puzzle: Puzzle,
  clues: Clue[],
  // TODO: Hardcode this
  limit = 2,
): SolveResult {
  const { rows, cols } = puzzle.gridSize
  const allPersonIds = puzzle.people.map(p => p.id)
  const solutions: PlacedPerson[][] = []

  // Pre-compute non-occupiable cells for O(1) lookup
  const nonOccupiable = new Set<string>()
  for (const obj of puzzle.objects) {
    if (obj.occupiable === 'non-occupiable') {
      for (const c of obj.cells) nonOccupiable.add(`${c.row},${c.col}`)
    }
  }

  // All valid (non-occupiable) cells — used as the default domain
  const allValidCells: Coord[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!nonOccupiable.has(`${r},${c}`))
        allValidCells.push({ row: r, col: c })

  // Room cell sets for domain narrowing
  const roomCellSets = new Map<string, Set<string>>()
  for (const room of puzzle.rooms) {
    roomCellSets.set(room.id, new Set(room.cells.map(c => `${c.row},${c.col}`)))
  }

  // Index clues by person for fast per-step evaluation.
  // Pair clues (personA/personB) are indexed under both so they fire when
  // either person is placed and the evaluator can return 'violated'.
  // person-alone-in-room / room-population / object-occupancy go to globalClues
  // because they can be violated by placing ANY person.
  const cluesByPerson = new Map<string, Clue[]>()
  for (const pid of allPersonIds) cluesByPerson.set(pid, [])
  const globalClues: Clue[] = []

  for (const clue of clues) {
    switch (clue.kind) {
      case 'person-direction':
      case 'person-distance':
      case 'persons-same-room':
      case 'persons-not-same-room':
        cluesByPerson.get(clue.personA)?.push(clue)
        cluesByPerson.get(clue.personB)?.push(clue)
        break
      case 'person-beside-object':
      case 'person-on-object':
      case 'person-in-room':
      case 'person-not-in-room':
        cluesByPerson.get(clue.person)?.push(clue)
        break
      case 'room-population':
      case 'object-occupancy':
      case 'person-alone-in-room':
        globalClues.push(clue)
        break
      default:
        assertNever(clue)
    }
  }

  // TODO: function to compute domains that takes an incomplete assignments map
  // TODO: restrict domain also for other clues: 
  // person-distance: if other person is in assignment, we can restict a lot (to single row/column), if not we can still restrict a little (A is 3 rows north of B => A can't be in the bottom 3 rows, B can't be in the top 3 rows)
  // person-direction: if other person is in assignment, we can restict a lot (to single square bounds), if not we can still restrict a little (A is north of B => A can't be in the bottom row, B can't be in the top row)
  // persons-same-room: if other person is in assignment or other person domain is in single room, we can restrict
  // persons-not-same-room: same as above
  // person-beside-object: can restrict to cells adjacent to objects (can precompute cells adjacent to each obj at start)
  // person-on-object: same as above
  // room-population: if N assignees already in room, can restrict to outside
  // ...
  // person-alone-in-room: Same as person-in-room. Besides, can restrict all others to not in room 
  // The domain can be restricted more and more with each clue

  // Narrow each person's domain using room constraints.
  // person-in-room  → domain ∩= room cells
  // person-not-in-room → domain -= room cells
  // Persons with no room clue get the full allValidCells domain.
  const personDomains = new Map<string, Coord[]>()
  for (const personId of allPersonIds) {
    let domainKeys: Set<string> | null = null

    for (const clue of cluesByPerson.get(personId) ?? []) {
      if (clue.kind === 'person-in-room') {
        const rSet = roomCellSets.get(clue.roomId)
        if (rSet) {
          if (domainKeys !== null) {
            const next = new Set<string>()
            for (const k of domainKeys) if (rSet.has(k)) next.add(k)
            domainKeys = next
          } else {
            domainKeys = new Set(rSet)
          }
        }
      } else if (clue.kind === 'person-not-in-room') {
        const rSet = roomCellSets.get(clue.roomId)
        if (rSet) {
          if (!domainKeys) domainKeys = new Set(allValidCells.map(c => `${c.row},${c.col}`))
          for (const k of rSet) domainKeys.delete(k)
        }
      }
    }

    if (domainKeys !== null) {
      const coords: Coord[] = []
      for (const key of domainKeys) {
        if (nonOccupiable.has(key)) continue
        const i = key.indexOf(',')
        coords.push({ row: Number(key.slice(0, i)), col: Number(key.slice(i + 1)) })
      }
      personDomains.set(personId, coords)
    } else {
      personDomains.set(personId, allValidCells)
    }
  }

  const usedRows = new Set<number>()
  const usedCols = new Set<number>()
  const assignment = new Map<string, Coord>()

  // Propagate row/col reservations to a fixed point.
  // When all feasible cells for an unplaced person share the same row (or col),
  // that row (col) is reserved for them — no other person may use it. This can
  // cascade: reserving a row/col may collapse another person's domain to one
  // row/col, triggering further reservations.
  // rowFor/colFor record who owns each reservation so a person is not blocked by
  // their own reservation. Returns false if any person ends up with 0 feasible
  // cells (contradiction → prune the branch immediately).
  function propagate(
    effectiveRows: Set<number>,
    effectiveCols: Set<number>,
    rowFor: Map<number, string>,
    colFor: Map<number, string>,
  ): boolean {
    let changed = true
    while (changed) {
      changed = false
      for (const pid of allPersonIds) {
        if (assignment.has(pid)) continue
        const domain = personDomains.get(pid)!
        let firstRow = -1; let multiRow = false
        let firstCol = -1; let multiCol = false
        let hasFeasible = false
        for (const c of domain) {
          if ((!effectiveRows.has(c.row) || rowFor.get(c.row) === pid) &&
              (!effectiveCols.has(c.col) || colFor.get(c.col) === pid)) {
            hasFeasible = true
            if (!multiRow) {
              if (firstRow < 0) firstRow = c.row
              else if (firstRow !== c.row) multiRow = true
            }
            if (!multiCol) {
              if (firstCol < 0) firstCol = c.col
              else if (firstCol !== c.col) multiCol = true
            }
          }
        }
        if (!hasFeasible) return false
        if (!multiRow && !effectiveRows.has(firstRow)) {
          effectiveRows.add(firstRow); rowFor.set(firstRow, pid); changed = true
        }
        if (!multiCol && !effectiveCols.has(firstCol)) {
          effectiveCols.add(firstCol); colFor.set(firstCol, pid); changed = true
        }
      }
    }
    return true
  }

  function backtrack(): void {
    if (solutions.length >= limit) return

    if (assignment.size === allPersonIds.length) {
      // All placed: global clues must be satisfied (not just non-violated)
      for (const clue of globalClues) {
        if (evaluateClue(clue, assignment, puzzle) !== 'satisfied') return
      }
      // Murder condition: victim's room has exactly 2 people
      const victimId = puzzle.people.find(p => p.role === 'victim')?.id
      if (victimId) {
        const vc = assignment.get(victimId)
        if (vc) {
          const vRoom = getRoomId(vc, puzzle)
          if (vRoom) {
            let inRoom = 0
            for (const [, c] of assignment) {
              if (getRoomId(c, puzzle) === vRoom) inRoom++
            }
            if (inRoom !== 2) return
          }
        }
      }
      solutions.push(allPersonIds.map(id => ({ personId: id, coord: assignment.get(id)! })))
      return
    }

    // Propagate row/col reservations. If any person gets 0 feasible cells → prune.
    // effectiveRows/effectiveCols extend usedRows/usedCols with propagated reservations.
    // usedRows ⊆ effectiveRows; entries from actual placements are NOT in rowFor/colFor.
    const effectiveRows = new Set(usedRows)
    const effectiveCols = new Set(usedCols)
    const rowFor = new Map<number, string>()
    const colFor = new Map<number, string>()
    if (!propagate(effectiveRows, effectiveCols, rowFor, colFor)) return

    // MRV: pick the unplaced person with the fewest feasible cells under the
    // propagated constraints. Feasibility respects each person's own reservation.
    let nextPerson: string | null = null
    let minFeasible = Infinity
    for (const pid of allPersonIds) {
      if (assignment.has(pid)) continue
      const domain = personDomains.get(pid)!
      let count = 0
      for (const c of domain) {
        if ((!effectiveRows.has(c.row) || rowFor.get(c.row) === pid) &&
            (!effectiveCols.has(c.col) || colFor.get(c.col) === pid)) {
          if (++count >= minFeasible) break
        }
      }
      if (count < minFeasible) {
        minFeasible = count
        nextPerson = pid
        if (minFeasible === 0) break
      }
    }

    if (!nextPerson || minFeasible === 0) return

    // TODO: can we re-compute the person's domain here (i.e, cells where they can be placed) given the current assignment, so we can be more efficient?
    const domain = personDomains.get(nextPerson)!
    const myCluesToCheck = cluesByPerson.get(nextPerson) ?? []

    for (const { row, col } of domain) {
      // Skip cells blocked by actual placements (via usedRows ⊆ effectiveRows where
      // rowFor has no entry) or reserved by propagation for another person.
      if ((!effectiveRows.has(row) || rowFor.get(row) === nextPerson) &&
          (!effectiveCols.has(col) || colFor.get(col) === nextPerson)) {
        // Double-check actual Latin square (covers usedRows case via effectiveRows,
        // but be explicit so the assignment invariant is clear).
        if (usedRows.has(row) || usedCols.has(col)) continue

        assignment.set(nextPerson, { row, col })
        usedRows.add(row)
        usedCols.add(col)

        let violated = false
        for (const clue of myCluesToCheck) {
          if (evaluateClue(clue, assignment, puzzle) === 'violated') { violated = true; break }
        }
        if (!violated) {
          for (const clue of globalClues) {
            if (evaluateClue(clue, assignment, puzzle) === 'violated') { violated = true; break }
          }
        }

        if (!violated) backtrack()

        assignment.delete(nextPerson)
        usedRows.delete(row)
        usedCols.delete(col)

        if (solutions.length >= limit) return
      }
    }
  }

  backtrack()

  if (solutions.length === 0) return { status: 'none' }
  if (solutions.length === 1) return { status: 'unique', solution: solutions[0] }
  return { status: 'multiple', solutions: solutions.slice(0, 2) }
}
