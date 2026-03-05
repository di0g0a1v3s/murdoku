import { assertNever, type Clue, type Coord, type PlacedPerson, type Puzzle } from './types.js'
import { evaluateClue } from './clue-evaluator.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SolveResult =
  | { status: 'unique'; solution: PlacedPerson[] }
  | { status: 'multiple'; solutions: PlacedPerson[][] }
  | { status: 'none' }

// ─── Solver ───────────────────────────────────────────────────────────────────

export function solve(
  puzzle: Puzzle,
  clues: Clue[],
): SolveResult {
  const { rows, cols } = puzzle.gridSize
  const allPersonIds = puzzle.people.map(p => p.id)
  const solutions: PlacedPerson[][] = []

  // All valid (non-occupiable) cells — the starting set for domain computation
  const nonOccupiable = new Set<string>()
  for (const obj of puzzle.objects) {
    if (obj.occupiable === 'non-occupiable') {
      for (const c of obj.cells) nonOccupiable.add(`${c.row},${c.col}`)
    }
  }
  const allValidCells: Coord[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!nonOccupiable.has(`${r},${c}`))
        allValidCells.push({ row: r, col: c })

  // Index clues by person; pair clues indexed under both people.
  // Global clues (person-alone-in-room, room-population, object-occupancy) go in
  // globalClues — they can be violated by placing ANY person.
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
      case 'person-in-room-with':
        globalClues.push(clue)
        break
      default:
        assertNever(clue)
    }
  }

  // Murder condition: victim must be in a room with exactly 1 other person (the murderer)
  const victimId = puzzle.people.find(p => p.role === 'victim')?.id
  if(victimId == null) {
    throw new Error("No victim id")
  }
  const victimClue: Clue = { kind: 'person-in-room-with', person: victimId, count: 1, text: '' };
  globalClues.push(victimClue);
  

  // Compute valid cells for pid given the current assignment.
  // Starts from all valid (non-occupiable) cells, then filters:
  //   - Latin square: skip rows/cols already used by placed people
  //   - All applicable clues: temporarily place pid at the candidate cell and
  //     call evaluateClue — any 'violated' result eliminates the cell.
  //     Clues involving an unplaced partner return 'unknown' and pass through,
  //     except direction/distance clues which return 'violated' when the placed
  //     person's position makes the constraint geometrically impossible
  //     (e.g. "A is N of B" → A can't be in last row, B can't be in first row).
  function computeDomain(pid: string, assignment: Map<string, Coord>): Coord[] {
    const usedR = new Set<number>()
    const usedC = new Set<number>()
    for (const [, placed] of assignment) {
      usedR.add(placed.row)
      usedC.add(placed.col)
    }

    const myClues = cluesByPerson.get(pid) ?? []

    return allValidCells.filter(c => {
      if (usedR.has(c.row) || usedC.has(c.col)) return false

      assignment.set(pid, c)
      let ok = true
      for (const clue of myClues) {
        if (evaluateClue(clue, assignment, puzzle) === 'violated') { ok = false; break }
      }
      if (ok) {
        for (const clue of globalClues) {
          if (evaluateClue(clue, assignment, puzzle) === 'violated') { ok = false; break }
        }
      }
      assignment.delete(pid)
      return ok
    })
  }

  const assignment = new Map<string, Coord>()

  function backtrack(): void {
    if (solutions.length > 1) return

    if (assignment.size === allPersonIds.length) {
      // All placed: verify all clues are satisfied
      for (const clue of clues) {
        if (evaluateClue(clue, assignment, puzzle) !== 'satisfied') return
      }
      if (evaluateClue(victimClue, assignment, puzzle) !== 'satisfied') return
      solutions.push(allPersonIds.map(id => ({ personId: id, coord: assignment.get(id)! })))
      return
    }

    // Step 1: compute domains for all unplaced people.
    const domains = new Map<string, Coord[]>()
    for (const pid of allPersonIds) {
      if (assignment.has(pid)) continue
      domains.set(pid, computeDomain(pid, assignment))
    }

    // Step 2: propagate — iterate until stable or contradiction detected.
    // Two rules:
    //   Row/col locking: if a person's entire domain lies in one row (or col),
    //     that row (col) is reserved for them → remove it from everyone else's domain.
    //   2-cell cross elimination: if domain = {(r1,c1),(r2,c2)} with r1≠r2, c1≠c2,
    //     then cells (r1,c2) and (r2,c1) are blocked for ALL people regardless of which
    //     cell this person takes (proven by Latin-square: both cross-cells are always used).
    let changed = true
    while (changed) {
      changed = false

      const lockedRows = new Map<number, string>() // row → owner pid
      const lockedCols = new Map<number, string>() // col → owner pid
      const crossForbidden = new Set<string>()     // "r,c" blocked for everyone
      let contradiction = false

      for (const [pid, domain] of domains) {
        if (domain.length === 0) { contradiction = true; break }

        const uniqueRows = new Set(domain.map(c => c.row))
        if (uniqueRows.size === 1) {
          const row = domain[0]!.row
          if (lockedRows.has(row) && lockedRows.get(row) !== pid) { contradiction = true; break }
          lockedRows.set(row, pid)
        }

        const uniqueCols = new Set(domain.map(c => c.col))
        if (uniqueCols.size === 1) {
          const col = domain[0]!.col
          if (lockedCols.has(col) && lockedCols.get(col) !== pid) { contradiction = true; break }
          lockedCols.set(col, pid)
        }

        if (domain.length === 2) {
          const [a, b] = domain as [Coord, Coord]
          if (a.row !== b.row && a.col !== b.col) {
            crossForbidden.add(`${a.row},${b.col}`)
            crossForbidden.add(`${b.row},${a.col}`)
          }
        }
      }

      if (contradiction) return

      for (const [pid, domain] of domains) {
        const filtered = domain.filter(c => {
          const rOwner = lockedRows.get(c.row)
          if (rOwner !== undefined && rOwner !== pid) return false
          const cOwner = lockedCols.get(c.col)
          if (cOwner !== undefined && cOwner !== pid) return false
          if (crossForbidden.has(`${c.row},${c.col}`)) return false
          return true
        })
        if (filtered.length < domain.length) {
          if (filtered.length === 0) return
          domains.set(pid, filtered)
          changed = true
        }
      }
    }

    // Step 3: MRV — pick the unplaced person with the fewest feasible cells.
    let nextPerson: string | null = null
    let bestDomain: Coord[] = []
    let minFeasible = Infinity
    for (const [pid, domain] of domains) {
      if (domain.length < minFeasible) {
        minFeasible = domain.length
        nextPerson = pid
        bestDomain = domain
        if (minFeasible === 0) break
      }
    }

    if (!nextPerson || minFeasible === 0) return

    for (const { row, col } of bestDomain) {
      assignment.set(nextPerson, { row, col })
      backtrack()
      assignment.delete(nextPerson)
      if (solutions.length > 1) return
    }
  }

  backtrack()

  if (solutions.length === 0) return { status: 'none' }
  if (solutions.length === 1) return { status: 'unique', solution: solutions[0] }
  return { status: 'multiple', solutions: solutions.slice(0, 2) }
}
