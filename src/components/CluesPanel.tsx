import type { Clue } from '@shared/types'
import { ClueItem } from './ClueItem'

interface CluesPanelProps {
  clues: Clue[]
}

export function CluesPanel({ clues }: CluesPanelProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: '16px',
      background: '#fafaf8',
      borderRadius: 12,
      border: '1px solid rgba(0,0,0,0.1)',
      height: '100%',
      overflowY: 'auto',
    }}>
      <h3 style={{
        margin: '0 0 8px 0',
        fontSize: 14,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'rgba(0,0,0,0.4)',
      }}>
        Evidence
      </h3>
      {clues.map((clue, i) => (
        <ClueItem key={i} clue={clue} index={i} />
      ))}
    </div>
  )
}
