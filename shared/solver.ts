import { assertNever, type Clue, type Coord, type PlacedPerson, type Puzzle } from './types.js';
import { evaluateClue } from './clue-evaluator.js';
import { coordToKey } from './helpers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SolveMetrics {
  backtracks: number;
}

export type SolveResult =
  | { status: 'unique'; solution: PlacedPerson[]; metrics: SolveMetrics }
  | { status: 'multiple'; solutions: PlacedPerson[][] }
  | { status: 'none' }
  | { status: 'exceeded' };

// ─── Constraint propagation helpers ──────────────────────────────────────────

type PropagationConstraints = {
  lockedRows: Map<number, string>; // row → owner pid
  lockedCols: Map<number, string>; // col → owner pid
  crossForbidden: Set<string>; // "r,c" blocked for everyone
};

// Derives lock/cross-elimination constraints from current domains.
// Applies three rules:
//   1. Row/col locking: domain entirely in one row/col → reserve it for that person.
//   2. 2-cell cross elimination: domain = {(r1,c1),(r2,c2)} → (r1,c2) and (r2,c1) forbidden.
//   3. Hidden singles: only one person has cells in a row/col → lock it for them.
// Returns 'contradiction' if two people compete for the same locked row or col.
function computeConstraints(
  domains: Map<string, Coord[]>,
): PropagationConstraints | 'contradiction' {
  const lockedRows = new Map<number, string>();
  const lockedCols = new Map<number, string>();
  const crossForbidden = new Set<string>();

  for (const [pid, domain] of domains) {
    if (domain.length === 0) {
      return 'contradiction';
    }
    const uniqueRows = new Set(domain.map((c) => c.row));
    if (uniqueRows.size === 1) {
      const row = domain[0]!.row;
      if (lockedRows.has(row) && lockedRows.get(row) !== pid) {
        return 'contradiction';
      }
      lockedRows.set(row, pid);
    }
    const uniqueCols = new Set(domain.map((c) => c.col));
    if (uniqueCols.size === 1) {
      const col = domain[0]!.col;
      if (lockedCols.has(col) && lockedCols.get(col) !== pid) {
        return 'contradiction';
      }
      lockedCols.set(col, pid);
    }
    if (domain.length === 2) {
      const [a, b] = domain as [Coord, Coord];
      if (a.row !== b.row && a.col !== b.col) {
        crossForbidden.add(coordToKey({ row: a.row, col: b.col }));
        crossForbidden.add(coordToKey({ row: b.row, col: a.col }));
      }
    }
  }

  // Hidden singles
  const rowCandidates = new Map<number, string | null>();
  const colCandidates = new Map<number, string | null>();
  for (const [pid, domain] of domains) {
    for (const c of domain) {
      rowCandidates.set(
        c.row,
        rowCandidates.has(c.row) && rowCandidates.get(c.row) !== pid ? null : pid,
      );
      colCandidates.set(
        c.col,
        colCandidates.has(c.col) && colCandidates.get(c.col) !== pid ? null : pid,
      );
    }
  }
  for (const [row, pid] of rowCandidates) {
    if (pid !== null) {
      if (lockedRows.has(row) && lockedRows.get(row) !== pid) {
        return 'contradiction';
      }
      lockedRows.set(row, pid);
    }
  }
  for (const [col, pid] of colCandidates) {
    if (pid !== null) {
      if (lockedCols.has(col) && lockedCols.get(col) !== pid) {
        return 'contradiction';
      }
      lockedCols.set(col, pid);
    }
  }

  return { lockedRows, lockedCols, crossForbidden };
}

// Filters each domain using the computed constraints.
// Returns true if any domain shrank, false if stable, 'contradiction' if any domain becomes empty.
function applyConstraints(
  domains: Map<string, Coord[]>,
  { lockedRows, lockedCols, crossForbidden }: PropagationConstraints,
): boolean | 'contradiction' {
  let changed = false;
  for (const [pid, domain] of domains) {
    const filtered = domain.filter((c) => {
      if (lockedRows.get(c.row) !== undefined && lockedRows.get(c.row) !== pid) {
        return false;
      }
      if (lockedCols.get(c.col) !== undefined && lockedCols.get(c.col) !== pid) {
        return false;
      }
      if (crossForbidden.has(coordToKey(c))) {
        return false;
      }
      return true;
    });
    if (filtered.length < domain.length) {
      if (filtered.length === 0) {
        return 'contradiction';
      }
      domains.set(pid, filtered);
      changed = true;
    }
  }
  return changed;
}

// ─── Solver ───────────────────────────────────────────────────────────────────

export function makeVictimClue(puzzle: Puzzle): Clue {
  const victimId = puzzle.people.find((p) => p.role === 'victim')?.id;
  if (victimId == null) {
    throw new Error('No victim in puzzle');
  }
  return { kind: 'person-in-room-with', person: victimId, count: 1 };
}

export function solve(puzzle: Puzzle, clues: Clue[], maxBacktracks?: number): SolveResult {
  const { rows, cols } = puzzle.gridSize;
  const allPersonIds = puzzle.people.map((p) => p.id);
  const solutions: PlacedPerson[][] = [];

  // All valid (non-occupiable) cells — the starting set for domain computation
  const nonOccupiable = new Set<string>();
  for (const obj of puzzle.objects) {
    if (obj.occupiable === 'non-occupiable') {
      for (const c of obj.cells) {
        nonOccupiable.add(coordToKey(c));
      }
    }
  }
  const allValidCells: Coord[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!nonOccupiable.has(coordToKey({ row: r, col: c }))) {
        allValidCells.push({ row: r, col: c });
      }
    }
  }

  // Index clues by person; pair clues indexed under both people.
  // Global clues (person-alone-in-room, room-population, object-occupancy) go in
  // globalClues — they can be violated by placing ANY person.
  const cluesByPerson = new Map<string, Clue[]>();
  for (const pid of allPersonIds) {
    cluesByPerson.set(pid, []);
  }
  const globalClues: Clue[] = [];

  for (const clue of clues) {
    switch (clue.kind) {
      case 'person-direction':
      case 'person-distance':
      case 'persons-same-room':
      case 'persons-not-same-room':
        cluesByPerson.get(clue.personA)?.push(clue);
        cluesByPerson.get(clue.personB)?.push(clue);
        break;
      case 'person-beside-object':
      case 'person-on-object':
      case 'person-in-room':
      case 'person-not-in-room':
      case 'person-in-row':
      case 'person-in-col':
      case 'person-in-corner':
      case 'person-in-room-corner':
      case 'person-sole-occupant':
        cluesByPerson.get(clue.person)?.push(clue);
        break;
      case 'room-population':
      case 'object-occupancy':
      case 'person-alone-in-room':
      case 'person-in-room-with':
      case 'empty-rooms':
        globalClues.push(clue);
        break;
      default:
        assertNever(clue);
    }
  }

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
    const usedR = new Set<number>();
    const usedC = new Set<number>();
    for (const [, placed] of assignment) {
      usedR.add(placed.row);
      usedC.add(placed.col);
    }

    const myClues = cluesByPerson.get(pid) ?? [];

    return allValidCells.filter((c) => {
      if (usedR.has(c.row) || usedC.has(c.col)) {
        return false;
      }

      assignment.set(pid, c);
      let ok = true;
      for (const clue of myClues) {
        if (evaluateClue(clue, assignment, puzzle) === 'violated') {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const clue of globalClues) {
          if (evaluateClue(clue, assignment, puzzle) === 'violated') {
            ok = false;
            break;
          }
        }
      }
      assignment.delete(pid);
      return ok;
    });
  }

  let backtracks = 0;
  let exceeded = false;

  const assignment = new Map<string, Coord>();

  function backtrack(): void {
    if (solutions.length > 1 || exceeded) {
      return;
    }

    if (assignment.size === allPersonIds.length) {
      // All placed: verify all clues are satisfied
      for (const clue of clues) {
        if (evaluateClue(clue, assignment, puzzle) !== 'satisfied') {
          return;
        }
      }
      solutions.push(allPersonIds.map((id) => ({ personId: id, coord: assignment.get(id)! })));
      return;
    }

    // Step 1: compute domains for all unplaced people.
    const domains = new Map<string, Coord[]>();
    for (const pid of allPersonIds) {
      if (assignment.has(pid)) {
        continue;
      }
      domains.set(pid, computeDomain(pid, assignment));
    }

    // Step 2: propagate — iterate until stable or contradiction detected.
    // See computeConstraints / applyConstraints above for the three rules applied.
    let changed = true;
    while (changed) {
      const constraints = computeConstraints(domains);
      if (constraints === 'contradiction') {
        return;
      }
      const result = applyConstraints(domains, constraints);
      if (result === 'contradiction') {
        return;
      }
      changed = result;
    }

    // Step 3: MRV — pick the unplaced person with the fewest feasible cells.
    let nextPerson: string | null = null;
    let bestDomain: Coord[] = [];
    let minFeasible = Infinity;
    for (const [pid, domain] of domains) {
      if (domain.length < minFeasible) {
        minFeasible = domain.length;
        nextPerson = pid;
        bestDomain = domain;
        if (minFeasible === 0) {
          break;
        }
      }
    }

    if (!nextPerson || minFeasible === 0) {
      return;
    }

    backtracks += bestDomain.length - 1; // one branch leads to the solution, rest are wrong
    if (maxBacktracks !== undefined && backtracks > maxBacktracks) {
      exceeded = true;
      return;
    }

    for (const { row, col } of bestDomain) {
      assignment.set(nextPerson, { row, col });
      backtrack();
      assignment.delete(nextPerson);
      if (solutions.length > 1) {
        return;
      }
    }
  }

  backtrack();

  if (exceeded) {
    return { status: 'exceeded' };
  }
  if (solutions.length === 0) {
    return { status: 'none' };
  }
  if (solutions.length === 1) {
    return {
      status: 'unique',
      solution: solutions[0],
      metrics: { backtracks },
    };
  }
  return { status: 'multiple', solutions: solutions.slice(0, 2) };
}
