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
  const allValidKeys = new Set<string>()
  const allValidCells: Coord[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!nonOccupiable.has(`${r},${c}`)) {
        allValidKeys.add(`${r},${c}`)
        allValidCells.push({ row: r, col: c })
      }
    }
  }

  // Room cell sets for domain narrowing
  const roomCellSets = new Map<string, Set<string>>()
  for (const room of puzzle.rooms) {
    roomCellSets.set(room.id, new Set(room.cells.map(c => `${c.row},${c.col}`)))
  }

  // O(1) coord → roomId lookup
  const coordToRoom = new Map<string, string>()
  for (const room of puzzle.rooms) {
    for (const c of room.cells) coordToRoom.set(`${c.row},${c.col}`, room.id)
  }

  // Pre-compute valid cells adjacent (in same room) to each object kind
  const besideCellsByKind = new Map<string, Set<string>>()
  for (const obj of puzzle.objects) {
    for (const c of obj.cells) {
      const roomId = coordToRoom.get(`${c.row},${c.col}`)
      if (!roomId) continue
      const neighbors: Coord[] = [
        { row: c.row - 1, col: c.col },
        { row: c.row + 1, col: c.col },
        { row: c.row, col: c.col - 1 },
        { row: c.row, col: c.col + 1 },
      ]
      for (const n of neighbors) {
        if (n.row < 0 || n.row >= rows || n.col < 0 || n.col >= cols) continue
        if (coordToRoom.get(`${n.row},${n.col}`) !== roomId) continue
        if (nonOccupiable.has(`${n.row},${n.col}`)) continue
        if (!besideCellsByKind.has(obj.kind)) besideCellsByKind.set(obj.kind, new Set())
        besideCellsByKind.get(obj.kind)!.add(`${n.row},${n.col}`)
      }
    }
  }

  // Pre-compute occupiable cells of each object kind
  const onObjectCellsByKind = new Map<string, Set<string>>()
  for (const obj of puzzle.objects) {
    if (obj.occupiable !== 'occupiable') continue
    if (!onObjectCellsByKind.has(obj.kind)) onObjectCellsByKind.set(obj.kind, new Set())
    for (const c of obj.cells) onObjectCellsByKind.get(obj.kind)!.add(`${c.row},${c.col}`)
  }

  // Index clues by person for fast per-step evaluation.
  // Pair clues (personA/personB) are indexed under both so they fire when
  // either person is placed and the evaluator can return 'violated'.
  // person-alone-in-room / room-population / object-occupancy go to globalClues
  // because they can be violated by placing ANY person.
  const cluesByPerson = new Map<string, Clue[]>()
  for (const pid of allPersonIds) cluesByPerson.set(pid, [])
  const globalClues: Clue[] = []

  // TODO: Typesafe way of making sure all clue kinds are handled in computeDomain
  // TODO: add victim condition: Victim is alone in a room with another person
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

  // Compute the set of valid cells for a person given the current assignment.
  //
  // Static constraints (applied regardless of assignment):
  //   person-in-room        → domain ∩= room cells
  //   person-not-in-room    → domain -= room cells
  //   person-beside-object  → domain ∩= cells adjacent to objects of that kind (in same room)
  //   person-on-object      → domain ∩= occupiable cells of that object kind
  //   person-alone-in-room  → alone person: domain ∩= that room; all others: domain -= that room
  //   person-direction      → tighten row/col bounds (e.g. "A is N of B" → A's maxRow = rows-2,
  //                           B's minRow = 1; diagonals constrain both axes)
  //   person-distance       → tighten row/col bounds to the valid range given the fixed offset
  //                           (e.g. "A is 3 cols E of B" → A's minCol = 3, B's maxCol = cols-4)
  //
  // Dynamic constraints (applied when the relevant other person is already placed):
  //   Latin square          → exclude rows/cols already occupied by placed people
  //   person-direction      → filter to cells satisfying the directional constraint vs the placed other
  //   person-distance       → filter to the single row/col at the exact offset from the placed other
  //   persons-same-room     → filter to cells in the placed other's room
  //   persons-not-same-room → filter to cells not in the placed other's room
  //   room-population       → exclude rooms that have already reached their population cap

  function computeDomain(pid: string, assignment: Map<string, Coord>): Coord[] {
    // ── Static constraints: build domain as a set of coord keys ──────────────
    // Pure helpers — return a new set rather than mutating, so TypeScript's
    // control-flow analysis doesn't lose track of the type of `domainKeys`.
    function intersectDomain(d: Set<string> | null, keys: Set<string>): Set<string> {
      if (d === null) return new Set(keys)
      const next = new Set<string>()
      for (const k of d) if (keys.has(k)) next.add(k)
      return next
    }
    function excludeFromDomain(d: Set<string> | null, keys: Set<string>): Set<string> {
      const next = d !== null ? new Set(d) : new Set(allValidKeys)
      for (const k of keys) next.delete(k)
      return next
    }

    let domainKeys: Set<string> | null = null

    // Row/col bounds accumulated from direction/distance clues — no assignment needed.
    // Multiple clues on the same person tighten the bounds further via Math.min/max.
    let minRow = 0, maxRow = rows - 1
    let minCol = 0, maxCol = cols - 1

    for (const clue of cluesByPerson.get(pid) ?? []) {
      if (clue.kind === 'person-in-room') {
        const rSet = roomCellSets.get(clue.roomId)
        if (rSet) domainKeys = intersectDomain(domainKeys, rSet)
      } else if (clue.kind === 'person-not-in-room') {
        const rSet = roomCellSets.get(clue.roomId)
        if (rSet) domainKeys = excludeFromDomain(domainKeys, rSet)
      } else if (clue.kind === 'person-beside-object') {
        const cells = besideCellsByKind.get(clue.objectKind)
        if (cells) domainKeys = intersectDomain(domainKeys, cells)
      } else if (clue.kind === 'person-on-object') {
        const cells = onObjectCellsByKind.get(clue.objectKind)
        if (cells) domainKeys = intersectDomain(domainKeys, cells)
      } else if (clue.kind === 'person-direction') {
        // "A is [dir] of B": if pid is A apply A-side bounds; if pid is B apply B-side bounds.
        // Cardinal directions constrain one axis; diagonals constrain both.
        const a = clue.personA === pid  // true → pid is personA
        const d = clue.direction
        if (a ? (d === 'N' || d === 'NE' || d === 'NW') : (d === 'S' || d === 'SE' || d === 'SW')) maxRow = Math.min(maxRow, rows - 2)
        if (a ? (d === 'S' || d === 'SE' || d === 'SW') : (d === 'N' || d === 'NE' || d === 'NW')) minRow = Math.max(minRow, 1)
        if (a ? (d === 'E' || d === 'NE' || d === 'SE') : (d === 'W' || d === 'NW' || d === 'SW')) minCol = Math.max(minCol, 1)
        if (a ? (d === 'W' || d === 'NW' || d === 'SW') : (d === 'E' || d === 'NE' || d === 'SE')) maxCol = Math.min(maxCol, cols - 2)
      } else if (clue.kind === 'person-distance') {
        // "A is [distance] [dir] of B" on a single axis.
        // Evaluator: col axis E → a.col - b.col = distance; N axis → a.row - b.row = -distance
        const a = clue.personA === pid
        if (clue.axis === 'col') {
          if (clue.direction === 'E') {
            // A.col = B.col + distance  →  A.col ≥ distance;  B.col ≤ cols-1-distance
            if (a) minCol = Math.max(minCol, clue.distance)
            else   maxCol = Math.min(maxCol, cols - 1 - clue.distance)
          } else { // W: A.col = B.col - distance  →  A.col ≤ cols-1-distance;  B.col ≥ distance
            if (a) maxCol = Math.min(maxCol, cols - 1 - clue.distance)
            else   minCol = Math.max(minCol, clue.distance)
          }
        } else { // row
          if (clue.direction === 'S') {
            // A.row = B.row + distance  →  A.row ≥ distance;  B.row ≤ rows-1-distance
            if (a) minRow = Math.max(minRow, clue.distance)
            else   maxRow = Math.min(maxRow, rows - 1 - clue.distance)
          } else { // N: A.row = B.row - distance  →  A.row ≤ rows-1-distance;  B.row ≥ distance
            if (a) maxRow = Math.min(maxRow, rows - 1 - clue.distance)
            else   minRow = Math.max(minRow, clue.distance)
          }
        }
      }
    }

    // person-alone-in-room: alone person must be in that room; all others must not be
    for (const clue of globalClues) {
      if (clue.kind !== 'person-alone-in-room') continue
      const rSet = roomCellSets.get(clue.roomId)
      if (!rSet) continue
      if (pid === clue.person) {
        domainKeys = intersectDomain(domainKeys, rSet)
      } else {
        domainKeys = excludeFromDomain(domainKeys, rSet)
      }
    }

    // Convert to Coord[], applying row/col bounds and filtering non-occupiable cells
    const base: Coord[] = []
    if (domainKeys !== null) {
      for (const key of domainKeys) {
        if (nonOccupiable.has(key)) continue
        const i = key.indexOf(',')
        const row = Number(key.slice(0, i))
        const col = Number(key.slice(i + 1))
        if (row < minRow || row > maxRow || col < minCol || col > maxCol) continue
        base.push({ row, col })
      }
    } else {
      for (const c of allValidCells) {
        if (c.row >= minRow && c.row <= maxRow && c.col >= minCol && c.col <= maxCol) {
          base.push(c)
        }
      }
    }

    if (assignment.size === 0) return base

    // ── Dynamic constraints: filter base domain by current assignment ─────────
    // Pre-compute used rows/cols once for O(1) lookup in the filter below.
    const usedR = new Set<number>()
    const usedC = new Set<number>()
    for (const [, placed] of assignment) {
      usedR.add(placed.row)
      usedC.add(placed.col)
    }

    return base.filter(c => {
      // Latin square: skip rows/cols already occupied by a placed person
      if (usedR.has(c.row) || usedC.has(c.col)) return false

      const cKey = `${c.row},${c.col}`

      for (const clue of cluesByPerson.get(pid) ?? []) {
        switch (clue.kind) {
          case 'person-direction': {
            const otherId = clue.personA === pid ? clue.personB : clue.personA
            const other = assignment.get(otherId)
            if (other) {
              // If pid is personA, pid (at c) must be in direction `dir` relative to personB (other).
              // If pid is personB, personA (other) must be in direction `dir` relative to pid (at c).
              const [a, b] = clue.personA === pid ? [c, other] : [other, c]
              switch (clue.direction) {
                case 'N':  if (!(a.row < b.row)) return false; break
                case 'S':  if (!(a.row > b.row)) return false; break
                case 'E':  if (!(a.col > b.col)) return false; break
                case 'W':  if (!(a.col < b.col)) return false; break
                case 'NE': if (!(a.row < b.row && a.col > b.col)) return false; break
                case 'NW': if (!(a.row < b.row && a.col < b.col)) return false; break
                case 'SE': if (!(a.row > b.row && a.col > b.col)) return false; break
                case 'SW': if (!(a.row > b.row && a.col < b.col)) return false; break
              }
            }
            break
          }
          case 'person-distance': {
            const otherId = clue.personA === pid ? clue.personB : clue.personA
            const other = assignment.get(otherId)
            if (other) {
              const isPidA = clue.personA === pid
              if (clue.axis === 'col') {
                // Evaluator: a.col - b.col === distance for E, -distance for W
                const offset = clue.direction === 'E' ? clue.distance : -clue.distance
                const expected = isPidA ? other.col + offset : other.col - offset
                if (c.col !== expected) return false
              } else {
                // Evaluator: a.row - b.row === -distance for N, +distance for S
                const offset = clue.direction === 'S' ? clue.distance : -clue.distance
                const expected = isPidA ? other.row + offset : other.row - offset
                if (c.row !== expected) return false
              }
            }
            break
          }
          case 'persons-same-room': {
            const otherId = clue.personA === pid ? clue.personB : clue.personA
            const other = assignment.get(otherId)
            if (other) {
              const otherRoom = coordToRoom.get(`${other.row},${other.col}`)
              if (otherRoom && coordToRoom.get(cKey) !== otherRoom) return false
            }
            break
          }
          case 'persons-not-same-room': {
            const otherId = clue.personA === pid ? clue.personB : clue.personA
            const other = assignment.get(otherId)
            if (other) {
              const otherRoom = coordToRoom.get(`${other.row},${other.col}`)
              if (otherRoom && coordToRoom.get(cKey) === otherRoom) return false
            }
            break
          }
        }
      }

      // room-population: if the room has already hit its limit, don't add more
      const cRoom = coordToRoom.get(cKey)
      for (const clue of globalClues) {
        if (clue.kind === 'room-population' && cRoom === clue.roomId) {
          let countInRoom = 0
          for (const [, oc] of assignment) {
            if (coordToRoom.get(`${oc.row},${oc.col}`) === clue.roomId) countInRoom++
          }
          if (countInRoom >= clue.count) return false
        }
      }

      return true
    })
  }

  const assignment = new Map<string, Coord>()

  function backtrack(): void {
    if (solutions.length > 1) return

    if (assignment.size === allPersonIds.length) {
      // TODO: verify here all clues?
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

    // MRV: pick the unplaced person with the fewest feasible cells.
    // computeDomain already accounts for used rows/cols and all clue constraints,
    // so domain.length is the true feasible count — no additional filtering needed.
    // Save the winning domain to avoid recomputing it for the iteration below.
    let nextPerson: string | null = null
    let bestDomain: Coord[] = []
    let minFeasible = Infinity
    for (const pid of allPersonIds) {
      if (assignment.has(pid)) continue
      const domain = computeDomain(pid, assignment)
      if (domain.length < minFeasible) {
        minFeasible = domain.length
        nextPerson = pid
        bestDomain = domain
        if (minFeasible === 0) break
      }
    }
    // TODO: if while minFeasible > 1 or no changes: 
    // restrict domain further with:
    // if person domain is in single row/column, remove that row/column from other people's domain
    // if person's domain is 2 cells, restrict intersected cells fom other people's domains

    if (!nextPerson || minFeasible === 0) return

    const myCluesToCheck = cluesByPerson.get(nextPerson) ?? []

    for (const { row, col } of bestDomain) {
      assignment.set(nextPerson, { row, col })

      // TODO: dont need to evaluate here
      let violated = false
      for (const clue of myCluesToCheck) {
        if (evaluateClue(clue, assignment, puzzle) === 'violated') { 
          violated = true; 
          break 
        }
      }
      if (!violated) {
        for (const clue of globalClues) {
          if (evaluateClue(clue, assignment, puzzle) === 'violated') { 
            violated = true; 
            break 
          }
        }
      }

      if (!violated) backtrack()

      assignment.delete(nextPerson)

      if (solutions.length > 1) return
    }
  }

  backtrack()

  if (solutions.length === 0) return { status: 'none' }
  if (solutions.length === 1) return { status: 'unique', solution: solutions[0] }
  return { status: 'multiple', solutions: solutions.slice(0, 2) }
}
