import type { Clue } from '@shared/types'

const CLUE_ICONS: Record<Clue['kind'], string> = {
  'person-direction': '🧭',
  'person-distance': '📏',
  'person-beside-object': '👁️',
  'person-on-object': '🪑',
  'person-in-room': '🚪',
  'persons-same-room': '👥',
  'person-alone-in-room': '🔇',
  'room-population': '🏠',
  'object-occupancy': '📦',
  'person-not-in-room': '🚫',
  'persons-not-same-room': '↔️',
}

interface ClueItemProps {
  clue: Clue
  index: number
}

export function ClueItem({ clue, index }: ClueItemProps) {
  return (
    <div style={{
      display: 'flex',
      gap: 10,
      padding: '10px 12px',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.03)',
      borderLeft: '3px solid rgba(0,0,0,0.12)',
    }}>
      <div style={{
        minWidth: 28,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{CLUE_ICONS[clue.kind]}</span>
        <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', fontWeight: 600 }}>{index + 1}</span>
      </div>
      <p style={{
        margin: 0,
        fontSize: 14,
        lineHeight: 1.5,
        color: '#1a1a2e',
        fontStyle: 'italic',
      }}>
        {clue.text}
      </p>
    </div>
  )
}
