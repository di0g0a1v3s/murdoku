import { useState, useEffect, useMemo } from 'react';
import type { FullPuzzle } from '@shared/types';
import { evaluateClue } from '@shared/clue-evaluator';
import { makeVictimClue } from '@shared/solver';
import { GridCanvas } from './GridCanvas';
import { CluesPanel } from './CluesPanel';
import { CellPopup } from './CellPopup';
import { STORAGE_KEYS, DIFFICULTY_COLOR } from '../constants';
import { useWindowWidth } from '../hooks/useWindowWidth';
import { coordToKey } from '@shared/helpers';

type UndoEntry = { marks: Map<string, Set<string>>; committed: Map<string, string> };

interface PuzzleViewProps {
  puzzle: FullPuzzle;
  isCompleted: boolean;
  isDailyPuzzle?: boolean;
  undoStack: UndoEntry[];
  onUndoStackChange: (stack: UndoEntry[]) => void;
  onComplete: () => void;
  onReset: () => void;
}

const PROGRESS_KEY = (id: string) => `${STORAGE_KEYS.progressPrefix}${id}`;
const COMMITTED_KEY = (id: string) => `${STORAGE_KEYS.committedPrefix}${id}`;

function loadMarks(puzzleId: string): Map<string, Set<string>> {
  try {
    const stored = localStorage.getItem(PROGRESS_KEY(puzzleId));
    if (!stored) {
      return new Map();
    }
    const parsed = JSON.parse(stored) as Record<string, string[]>;
    return new Map(Object.entries(parsed).map(([k, v]) => [k, new Set(v)]));
  } catch {
    return new Map();
  }
}

function loadCommitted(puzzleId: string): Map<string, string> {
  try {
    const stored = localStorage.getItem(COMMITTED_KEY(puzzleId));
    if (!stored) {
      return new Map();
    }
    const parsed = JSON.parse(stored) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

// Returns a new marks map with all non-committed occupiable cells in the same
// row or column as (row, col) crossed out.
function crossOutRowCol(
  row: number,
  col: number,
  lockedKey: string,
  marks: Map<string, Set<string>>,
  committed: Map<string, string>,
  nonOccupiable: Set<string>,
  rows: number,
  cols: number,
): Map<string, Set<string>> {
  const next = new Map(marks);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${r},${c}`;
      if (k === lockedKey || (r !== row && c !== col) || committed.has(k) || nonOccupiable.has(k)) {
        continue;
      }
      next.set(k, new Set(['X']));
    }
  }
  return next;
}

// Scans marks to build a person→cell mapping.
// Returns hasMultiple=true if any cell has >1 person mark,
// and duplicates listing any person marked in more than one cell.
function buildPersonToKey(marks: Map<string, Set<string>>): {
  personToKey: Map<string, string>;
  hasMultiple: boolean;
  duplicates: string[];
} {
  let hasMultiple = false;
  const personToKey = new Map<string, string>();
  const duplicateIds: string[] = [];
  for (const [key, cellMarkSet] of marks) {
    const personIds = [...cellMarkSet].filter((m) => m !== 'X');
    if (personIds.length > 1) {
      hasMultiple = true;
    } else if (personIds.length === 1) {
      const pid = personIds[0]!;
      if (personToKey.has(pid)) {
        duplicateIds.push(pid);
      } else {
        personToKey.set(pid, key);
      }
    }
  }
  return { personToKey, hasMultiple, duplicates: duplicateIds };
}

export function PuzzleView({
  puzzle,
  isCompleted,
  isDailyPuzzle,
  undoStack,
  onUndoStackChange,
  onComplete,
  onReset,
}: PuzzleViewProps) {
  const [showSolution, setShowSolution] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  // cellMarks: "row,col" → Set of personId | 'X'
  // Initialized from localStorage; component remounts when puzzle changes (key={puzzle.id} in App)
  const [cellMarks, setCellMarks] = useState<Map<string, Set<string>>>(() => loadMarks(puzzle.id));
  const [committedCells, setCommittedCells] = useState<Map<string, string>>(() =>
    loadCommitted(puzzle.id),
  );
  const [popup, setPopup] = useState<{ row: number; col: number; x: number; y: number } | null>(
    null,
  );
  const [verifyResult, setVerifyResult] = useState<'correct' | 'wrong' | null>(
    isCompleted ? 'correct' : null,
  );
  const [verifyHint, setVerifyHint] = useState<string | null>(null);

  const nonOccupiable = useMemo(() => {
    const s = new Set<string>();
    for (const obj of puzzle.objects) {
      if (obj.occupiable === 'non-occupiable') {
        for (const c of obj.cells) {
          s.add(coordToKey(c));
        }
      }
    }
    return s;
  }, [puzzle.objects]);

  // Persist marks to localStorage whenever they change
  useEffect(() => {
    try {
      if (cellMarks.size === 0) {
        localStorage.removeItem(PROGRESS_KEY(puzzle.id));
      } else {
        const obj = Object.fromEntries([...cellMarks].map(([k, v]) => [k, [...v]]));
        localStorage.setItem(PROGRESS_KEY(puzzle.id), JSON.stringify(obj));
      }
    } catch {
      /* ignore quota/private-mode errors */
    }
  }, [cellMarks, puzzle.id]);

  // Persist committed cells to localStorage
  useEffect(() => {
    try {
      if (committedCells.size === 0) {
        localStorage.removeItem(COMMITTED_KEY(puzzle.id));
      } else {
        const obj = Object.fromEntries(committedCells);
        localStorage.setItem(COMMITTED_KEY(puzzle.id), JSON.stringify(obj));
      }
    } catch {
      /* ignore */
    }
  }, [committedCells, puzzle.id]);

  const windowWidth = useWindowWidth();

  function handleCellClick(row: number, col: number, e: React.MouseEvent) {
    setPopup((prev) =>
      prev?.row === row && prev?.col === col ? null : { row, col, x: e.clientX, y: e.clientY },
    );
  }

  function handleToggleMark(mark: string) {
    if (!popup) {
      return;
    }
    const key = coordToKey(popup);
    onUndoStackChange([...undoStack, { marks: cellMarks, committed: committedCells }]);
    setCellMarks((prev) => {
      const next = new Map(prev);
      const cell = new Set(prev.get(key) ?? []);
      if (mark === 'X') {
        if (cell.has('X')) {
          cell.delete('X');
        } else {
          cell.clear();
          cell.add('X');
        }
      } else {
        if (cell.has(mark)) {
          cell.delete(mark);
        } else {
          cell.delete('X');
          cell.add(mark);
        }
      }
      if (cell.size === 0) {
        next.delete(key);
      } else {
        next.set(key, cell);
      }
      return next;
    });
    // Toggling a mark un-commits the cell
    setCommittedCells((prev) => {
      if (!prev.has(key)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setVerifyResult(null);
    setPopup(null);
  }

  function handleUncommit(row: number, col: number) {
    const key = coordToKey({ row, col });
    onUndoStackChange([...undoStack, { marks: cellMarks, committed: committedCells }]);
    setCommittedCells((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setVerifyResult(null);
    setPopup(null);
  }

  function handleCommit(row: number, col: number, personId: string) {
    const key = coordToKey({ row, col });
    onUndoStackChange([...undoStack, { marks: cellMarks, committed: committedCells }]);

    // Remove personId from all other cells; set this cell to exactly {personId}
    const newMarks = new Map(cellMarks);
    for (const [k, marks] of newMarks) {
      if (k === key) {
        continue;
      }
      if (marks.has(personId)) {
        const newSet = new Set(marks);
        newSet.delete(personId);
        if (newSet.size === 0) {
          newMarks.delete(k);
        } else {
          newMarks.set(k, newSet);
        }
      }
    }
    newMarks.set(key, new Set([personId]));

    // Commit this cell
    const newCommitted = new Map(committedCells);
    newCommitted.set(key, personId);

    // Cross out all other occupiable cells in the same row or column that aren't committed
    const crossedMarks = crossOutRowCol(
      row,
      col,
      key,
      newMarks,
      newCommitted,
      nonOccupiable,
      puzzle.gridSize.rows,
      puzzle.gridSize.cols,
    );

    setCellMarks(crossedMarks);
    setCommittedCells(newCommitted);
    setPopup(null);
    setVerifyResult(null);

    // Auto-verify when all people are committed
    if (newCommitted.size === puzzle.people.length) {
      runVerify(crossedMarks);
    }
  }

  function runVerify(marks: Map<string, Set<string>>) {
    const fail = (hint: string) => {
      setVerifyHint(hint);
      setVerifyResult('wrong');
    };

    // Build person → cell mapping from marks
    const { personToKey, hasMultiple, duplicates } = buildPersonToKey(marks);

    if (hasMultiple) {
      fail('Some cells have multiple suspects marked.');
      return;
    }

    if (duplicates.length > 0) {
      const names = duplicates
        .map((pid) => puzzle.people.find((p) => p.id === pid)!.name)
        .reduce(
          (acc, name, i, arr) =>
            i === arr.length - 1 && arr.length > 1
              ? `${acc} and ${name}`
              : i === 0
                ? name
                : `${acc}, ${name}`,
          '',
        );
      fail(`${names} ${duplicates.length === 1 ? 'is' : 'are'} marked in more than one cell.`);
      return;
    }

    const unplaced = puzzle.people.filter((p) => !personToKey.has(p.id));
    if (unplaced.length > 0) {
      fail(`Not yet placed: ${unplaced.map((p) => p.name).join(', ')}.`);
      return;
    }

    // Check Latin square
    const rowOwner = new Map<number, string>();
    const colOwner = new Map<number, string>();
    for (const [pid, key] of personToKey) {
      const [row, col] = key.split(',').map(Number);
      const name = puzzle.people.find((p) => p.id === pid)!.name;
      if (rowOwner.has(row)) {
        fail(
          `${name} and ${puzzle.people.find((p) => p.id === rowOwner.get(row))!.name} are in the same row.`,
        );
        return;
      }
      rowOwner.set(row, pid);
      if (colOwner.has(col)) {
        fail(
          `${name} and ${puzzle.people.find((p) => p.id === colOwner.get(col))!.name} are in the same column.`,
        );
        return;
      }
      colOwner.set(col, pid);
    }

    // Check clues against current placement
    const assignment = new Map(
      [...personToKey].map(([pid, key]) => {
        const [row, col] = key.split(',').map(Number);
        return [pid, { row, col }] as const;
      }),
    );
    const violatedClue = puzzle.clues.find(
      (c) => evaluateClue(c, assignment, puzzle) === 'violated',
    );
    if (violatedClue) {
      fail(`At least one clue is not satisfied: "${violatedClue.text}"`);
      return;
    }

    // Check victim clue: victim must be alone in a room with exactly the murderer
    if (evaluateClue(makeVictimClue(puzzle), assignment, puzzle) !== 'satisfied') {
      fail('The victim is not alone in a room with the murderer.');
      return;
    }

    setVerifyHint(null);
    setVerifyResult('correct');
    onComplete();
    setCommittedCells(new Map([...personToKey].map(([pid, key]) => [key, pid])));
  }

  function handleVerify() {
    runVerify(cellMarks);
  }

  function handleUndo() {
    if (undoStack.length === 0) {
      return;
    }
    const next = [...undoStack];
    const last = next.pop()!;
    setCellMarks(last.marks);
    setCommittedCells(last.committed);
    setVerifyResult(null);
    setVerifyHint(null);
    onUndoStackChange(next);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function handleClear() {
    setCellMarks(new Map());
    setCommittedCells(new Map());
    onUndoStackChange([]);
    setVerifyResult(null);
    setVerifyHint(null);
  }

  function handleReset() {
    setCellMarks(new Map());
    setCommittedCells(new Map());
    onUndoStackChange([]);
    setVerifyResult(null);
    onReset();
  }

  const isMobile = windowWidth < 640;
  const availableWidth = Math.min(windowWidth - 32, isMobile ? windowWidth - 32 : 400);
  const cellSize = Math.floor(availableWidth / puzzle.gridSize.cols);

  const solutionMarks = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of puzzle.solution.placements) {
      m.set(coordToKey(p.coord), new Set([p.personId]));
    }
    return m;
  }, [puzzle.solution.placements]);

  const solutionCommitted = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of puzzle.solution.placements) {
      m.set(coordToKey(p.coord), p.personId);
    }
    return m;
  }, [puzzle.solution.placements]);

  const effectiveMarks = showSolution ? solutionMarks : cellMarks;
  const effectiveCommitted = showSolution ? solutionCommitted : committedCells;

  function handleReveal() {
    setShowSolution(true);
    setPopup(null);
  }

  function handleHide() {
    setShowSolution(false);
  }

  const popupMarks = popup
    ? (cellMarks.get(coordToKey(popup)) ?? new Set<string>())
    : new Set<string>();
  const popupCommitted = popup ? committedCells.has(coordToKey(popup)) : false;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: 'center',
          padding: '20px 16px 12px',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          {isDailyPuzzle && (
            <>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.35)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Daily Puzzle
              </span>
              <span style={{ color: 'rgba(0,0,0,0.3)', fontSize: 13 }}>|</span>
            </>
          )}
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: DIFFICULTY_COLOR[puzzle.difficulty],
            }}
          >
            {puzzle.difficulty === 'very-hard'
              ? 'Very Hard'
              : puzzle.difficulty.charAt(0).toUpperCase() + puzzle.difficulty.slice(1)}
          </span>
        </div>
        <h1
          style={{
            margin: '0 0 4px 0',
            fontSize: isMobile ? 24 : 31,
            fontWeight: 800,
            color: '#1a1a2e',
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          {puzzle.title}
        </h1>
        {puzzle.subtitle && (
          <p
            style={{
              margin: '0 0 16px 0',
              fontSize: 17,
              color: 'rgba(0,0,0,0.45)',
              fontStyle: 'italic',
            }}
          >
            {puzzle.subtitle}
          </p>
        )}
      </div>

      {/* Main content area */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 16,
          width: '100%',
          padding: '0 16px 24px',
          alignItems: isMobile ? 'center' : 'flex-start',
          boxSizing: 'border-box',
        }}
      >
        {/* Grid */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              border:
                verifyResult === 'correct'
                  ? '2px solid #16a34a'
                  : verifyResult === 'wrong'
                    ? '2px solid #dc2626'
                    : '2px solid rgba(0,0,0,0.15)',
            }}
          >
            <GridCanvas
              puzzle={puzzle}
              cellSize={cellSize}
              cellMarks={effectiveMarks}
              committedCells={effectiveCommitted}
              onCellClick={showSolution ? undefined : handleCellClick}
            />
          </div>

          {/* Reveal / hide solution */}
          {showSolution && (
            <button
              onClick={handleHide}
              style={{
                padding: '8px 22px',
                background: 'transparent',
                color: '#7c3aed',
                border: '2px solid #7c3aed',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Hide Solution
            </button>
          )}
          {/* Result banner / controls */}
          {!showSolution && (
            <div style={{ width: cellSize * puzzle.gridSize.cols }}>
              {verifyResult === 'correct' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      padding: '8px 20px',
                      background: '#dcfce7',
                      color: '#15803d',
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 700,
                      border: '1px solid #86efac',
                    }}
                  >
                    {(() => {
                      const murderer = puzzle.people.find(
                        (p) => p.id === puzzle.solution.murdererId,
                      );
                      const victim = puzzle.people.find((p) => p.id === puzzle.solution.victimId);
                      const room = puzzle.rooms.find((r) => r.id === puzzle.solution.murderRoom);
                      return `✓ Case closed! ${murderer?.name ?? '?'} killed ${victim?.name ?? '?'} in the ${room?.name ?? '?'}.`;
                    })()}
                  </div>
                  <button
                    onClick={handleReset}
                    style={{
                      padding: '8px 14px',
                      background: 'transparent',
                      color: 'rgba(0,0,0,0.4)',
                      border: '1px solid rgba(0,0,0,0.15)',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Reset puzzle"
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <div
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleUndo}
                      disabled={undoStack.length === 0}
                      title="Undo (⌘Z)"
                      style={{
                        padding: '10px 14px',
                        background: 'transparent',
                        color: undoStack.length === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.5)',
                        border: '1px solid',
                        borderColor: undoStack.length === 0 ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
                        borderRadius: 8,
                        fontSize: 17,
                        cursor: undoStack.length === 0 ? 'default' : 'pointer',
                      }}
                    >
                      ↩
                    </button>
                    <button
                      onClick={handleClear}
                      disabled={cellMarks.size === 0}
                      title="Clear board"
                      style={{
                        padding: '10px 14px',
                        background: 'transparent',
                        color: cellMarks.size === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.5)',
                        border: '1px solid',
                        borderColor: cellMarks.size === 0 ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: cellMarks.size === 0 ? 'default' : 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    onClick={handleVerify}
                    style={{
                      padding: '10px 28px',
                      background: '#1a1a2e',
                      color: 'white',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 17,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    }}
                  >
                    Verify Solution
                  </button>
                  {verifyResult === 'wrong' && verifyHint && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>
                      {verifyHint}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Clues panel */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            width: isMobile ? '100%' : undefined,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <CluesPanel
            clues={puzzle.clues}
            people={puzzle.people}
            suspectSummaries={puzzle.suspectSummaries}
            lockedPersonIds={new Set(committedCells.values())}
          />
          {!showSolution && (
            <button
              onClick={handleReveal}
              style={{
                padding: '10px 28px',
                background: '#7c3aed',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(124,58,237,0.4)',
                alignSelf: 'center',
              }}
            >
              Reveal Solution
            </button>
          )}
        </div>
      </div>

      {/* How to play */}
      <details
        onToggle={(e) => setHowToPlayOpen((e.currentTarget as HTMLDetailsElement).open)}
        style={{
          width: '100%',
          padding: '0 16px 24px',
          boxSizing: 'border-box',
        }}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
            color: 'rgba(0,0,0,0.35)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            userSelect: 'none',
            listStyle: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span style={{ fontSize: 11 }}>{howToPlayOpen ? '▼' : '▶'}</span>
          How to play
        </summary>
        <div
          style={{
            marginTop: 10,
            padding: '12px 14px',
            background: 'rgba(0,0,0,0.03)',
            borderRadius: 8,
            border: '1px solid rgba(0,0,0,0.08)',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#1a1a2e',
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
          }}
        >
          <p style={{ margin: 0 }}>
            Place every suspect (and the victim) on the grid — one per row, one per column, just
            like Sudoku. People cannot stand on non-occupiable objects (tables, plants,
            bookshelves…).
          </p>
          <p style={{ margin: 0 }}>
            The <strong>murderer</strong> is the suspect who ends up{' '}
            <strong>alone in the same room as the victim</strong> — exactly two people in that room,
            no one else.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Reading clues:</strong> cardinal directions (north, south, east, west) compare
            only one axis — "north" means a lower row regardless of column. Diagonal directions
            (northeast, etc.) compare both. &ldquo;Beside&rdquo; an object means orthogonally
            adjacent <em>and in the same room</em>.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Annotating:</strong> click any cell to mark it with a suspect&apos;s initial or
            ✕ to rule them out. Hit <strong>Lock ✓</strong> when you&apos;re confident — this turns
            the letter green, removes that person from all other cells, and crosses out the rest of
            their row and column. Locking everyone auto-verifies the solution. You can also hit{' '}
            <strong>Verify Solution</strong> at any time to check early — if something&apos;s wrong,
            you&apos;ll see a specific hint about what to fix.
          </p>
        </div>
      </details>

      {/* Cell mark popup */}
      {popup && (
        <CellPopup
          people={puzzle.people}
          marks={popupMarks}
          committed={popupCommitted}
          position={{ x: popup.x, y: popup.y }}
          onToggle={handleToggleMark}
          onCommit={(personId) => handleCommit(popup.row, popup.col, personId)}
          onUncommit={() => handleUncommit(popup.row, popup.col)}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
