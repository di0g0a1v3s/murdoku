import type { Puzzle } from '@shared/types'

interface PuzzleSelectorProps {
  puzzles: Puzzle[]
  selectedId: string
  onSelect: (id: string) => void
}

export function PuzzleSelector({ puzzles, selectedId, onSelect }: PuzzleSelectorProps) {
  if (puzzles.length <= 1) return null

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      justifyContent: 'center',
      padding: '12px 16px',
    }}>
      {puzzles.map(puzzle => (
        <button
          key={puzzle.id}
          onClick={() => onSelect(puzzle.id)}
          style={{
            padding: '7px 14px',
            borderRadius: 20,
            border: '2px solid',
            borderColor: puzzle.id === selectedId ? '#7c3aed' : 'rgba(0,0,0,0.15)',
            background: puzzle.id === selectedId ? '#7c3aed' : 'white',
            color: puzzle.id === selectedId ? 'white' : '#333',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {puzzle.title}
        </button>
      ))}
    </div>
  )
}
