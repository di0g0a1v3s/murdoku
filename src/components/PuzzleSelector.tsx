import type { Puzzle } from '@shared/types';

interface PuzzleSelectorProps {
  puzzles: Puzzle[];
  selectedId: string;
  onSelect: (id: string) => void;
  completedIds: Set<string>;
}

function getDifficulty(puzzle: Puzzle): 'Easy' | 'Medium' | 'Hard' {
  const n = puzzle.people.length;
  if (n <= 6) {
    return 'Easy';
  }
  if (n <= 9) {
    return 'Medium';
  }
  return 'Hard';
}

const DIFFICULTY_ORDER = ['Easy', 'Medium', 'Hard'] as const;

const DIFFICULTY_COLOR: Record<string, string> = {
  Easy: '#16a34a',
  Medium: '#d97706',
  Hard: '#dc2626',
};

export function PuzzleSelector({
  puzzles,
  selectedId,
  onSelect,
  completedIds,
}: PuzzleSelectorProps) {
  if (puzzles.length <= 1) {
    return null;
  }

  const groups = DIFFICULTY_ORDER.map((label) => ({
    label,
    puzzles: puzzles.filter((p) => getDifficulty(p) === label),
  })).filter((g) => g.puzzles.length > 0);

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map(({ label, puzzles: group }) => (
        <div key={label}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: DIFFICULTY_COLOR[label],
              marginBottom: 6,
              paddingLeft: 4,
            }}
          >
            {label}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {group.map((puzzle) => {
              const isSelected = puzzle.id === selectedId;
              const isCompleted = completedIds.has(puzzle.id);
              return (
                <button
                  key={puzzle.id}
                  onClick={() => onSelect(puzzle.id)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 20,
                    border: '2px solid',
                    borderColor: isSelected
                      ? '#7c3aed'
                      : isCompleted
                        ? '#16a34a'
                        : 'rgba(0,0,0,0.15)',
                    background: isSelected ? '#7c3aed' : isCompleted ? '#f0fdf4' : 'white',
                    color: isSelected ? 'white' : isCompleted ? '#15803d' : '#333',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isCompleted && '✓ '}
                  {puzzle.title}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
