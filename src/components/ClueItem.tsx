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
}

export function ClueItem({ clue }: ClueItemProps) {
  return (
    <div style={{
      display: 'flex',
      gap: 10,
      padding: '8px 10px',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.03)',
      borderLeft: '3px solid rgba(0,0,0,0.12)',
    }}>
      <span style={{ fontSize: 19, lineHeight: 1.4, flexShrink: 0 }}>{CLUE_ICONS[clue.kind]}</span>
      <p style={{
        margin: 0,
        fontSize: 15,
        lineHeight: 1.5,
        color: '#1a1a2e',
      }}>
        {clue.text}
      </p>
    </div>
  )
}
