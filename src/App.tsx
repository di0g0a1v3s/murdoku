import { useState } from 'react';
import type { FullPuzzle, PuzzleCollection } from '@shared/types';
import puzzleData from './puzzles/puzzles.json';
import { PuzzleView } from './components/PuzzleView';
import { PuzzleSelector } from './components/PuzzleSelector';
import { STORAGE_KEYS } from './constants';

const collection = puzzleData as PuzzleCollection;

// Fixed epoch: the day this daily-puzzle feature was deployed.
// New puzzles added later always get newer generatedAt → appended to end → stable.
const EPOCH_DAY = Math.floor(new Date('2026-02-23').getTime() / 86400000);
const TODAY_DAY_OFFSET = Math.max(0, Math.floor(Date.now() / 86400000) - EPOCH_DAY);

function getDailyPuzzle(puzzles: FullPuzzle[]): FullPuzzle | undefined {
  if (puzzles.length === 0) {
    return undefined;
  }
  const sorted = [...puzzles].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  return sorted[TODAY_DAY_OFFSET % sorted.length];
}

export function App() {
  const puzzles = collection.puzzles;
  const [selectedId, setSelectedId] = useState(() => getDailyPuzzle(puzzles)?.id ?? '');
  const [showArchive, setShowArchive] = useState(false);
  const [undoStacks, setUndoStacks] = useState<
    Map<string, { marks: Map<string, Set<string>>; committed: Map<string, string> }[]>
  >(new Map());

  const [completedIds, setCompletedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.completed);
      return new Set(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  const dailyPuzzle = getDailyPuzzle(puzzles);
  const isViewingDailyPuzzle = selectedId === dailyPuzzle?.id;

  // Only show puzzles that have been "released" (up to and including today's)
  const releasedPuzzles =
    puzzles.length === 0
      ? puzzles
      : [...puzzles]
          .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
          .slice(0, Math.min(TODAY_DAY_OFFSET + 1, puzzles.length));
  function handleComplete(id: string) {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(STORAGE_KEYS.completed, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function handleUndoStackChange(
    id: string,
    stack: { marks: Map<string, Set<string>>; committed: Map<string, string> }[],
  ) {
    setUndoStacks((prev) => new Map(prev).set(id, stack));
  }

  function handleReset(id: string) {
    setUndoStacks((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setCompletedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      try {
        localStorage.setItem(STORAGE_KEYS.completed, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
    try {
      localStorage.removeItem(`${STORAGE_KEYS.progressPrefix}${id}`);
    } catch {
      /* ignore */
    }
  }

  const selectedPuzzle = puzzles.find((p) => p.id === selectedId) ?? puzzles[0];

  if (puzzles.length === 0) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#1a1a2e',
          flexDirection: 'column',
          gap: 16,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 48 }}>🕵️</div>
        <h1 style={{ margin: 0, fontSize: 33, fontWeight: 800 }}>Murdoku</h1>
        <p style={{ margin: 0, color: 'rgba(0,0,0,0.5)', fontSize: 19 }}>
          No puzzles yet. Run{' '}
          <code
            style={{
              background: '#f1f5f9',
              padding: '2px 6px',
              borderRadius: 4,
              fontFamily: 'monospace',
            }}
          >
            npm run generate
          </code>{' '}
          to create one.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f8f6f0',
        color: '#1a1a2e',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          background: '#1a1a2e',
          color: 'white',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 26 }}>🕵️</span>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>Murdoku</span>
        <span
          className="header-subtitle"
          style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.4)',
            fontStyle: 'italic',
            marginLeft: 4,
          }}
        >
          Murder Mystery Logic Puzzles
        </span>
        <div style={{ flex: 1 }} />
        {releasedPuzzles.length > 1 && (
          <button
            onClick={() => setShowArchive(true)}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: 'white',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '5px 12px',
              borderRadius: 6,
            }}
          >
            All Puzzles
          </button>
        )}
      </div>

      {/* Archive back-link band — only shown when not on the daily puzzle */}
      {dailyPuzzle && !isViewingDailyPuzzle && (
        <div
          style={{
            padding: '8px 20px',
            background: '#f8f6f0',
            borderBottom: '1px solid rgba(0,0,0,0.07)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <button
            onClick={() => setSelectedId(dailyPuzzle.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#7c3aed',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ← Daily Puzzle
          </button>
        </div>
      )}

      {selectedPuzzle && (
        <PuzzleView
          key={selectedPuzzle.id}
          puzzle={selectedPuzzle}
          isCompleted={completedIds.has(selectedPuzzle.id)}
          isDailyPuzzle={isViewingDailyPuzzle}
          undoStack={undoStacks.get(selectedPuzzle.id) ?? []}
          onUndoStackChange={(stack) => handleUndoStackChange(selectedPuzzle.id, stack)}
          onComplete={() => handleComplete(selectedPuzzle.id)}
          onReset={() => handleReset(selectedPuzzle.id)}
        />
      )}

      {/* Archive modal */}
      {showArchive && (
        <div
          onClick={() => setShowArchive(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: 60,
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#f8f6f0',
              borderRadius: 12,
              width: '100%',
              maxWidth: 640,
              margin: '0 16px 60px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#1a1a2e',
                color: 'white',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 17 }}>Puzzle Archive</span>
              <button
                onClick={() => setShowArchive(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 22,
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
            <PuzzleSelector
              puzzles={releasedPuzzles}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setShowArchive(false);
              }}
              completedIds={completedIds}
              dailyPuzzleId={dailyPuzzle?.id}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
