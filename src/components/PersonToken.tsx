import type { CSSProperties } from 'react'
import type { Person } from '@shared/types'

interface PersonTokenProps {
  person: Person
  col: number
  row: number
  cellSize: number
  isVictim: boolean
  isMurderer: boolean
}

export function PersonToken({ person, col, row, cellSize, isVictim, isMurderer }: PersonTokenProps) {
  const style: CSSProperties = {
    gridColumn: col + 1,
    gridRow: row + 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
    pointerEvents: 'none',
    gap: 1,
  }

  const tokenSize = cellSize * 0.55
  const bgColor = isVictim ? '#dc2626' : isMurderer ? '#7c3aed' : '#1d4ed8'

  return (
    <div style={style}>
      <div style={{
        width: tokenSize,
        height: tokenSize,
        borderRadius: '50%',
        background: bgColor,
        border: '2px solid white',
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: tokenSize * 0.55,
        lineHeight: 1,
      }}>
        {person.avatarEmoji ?? '👤'}
      </div>
      <div style={{
        fontSize: cellSize * 0.1,
        fontWeight: 700,
        color: bgColor,
        textAlign: 'center',
        lineHeight: 1.1,
        maxWidth: cellSize * 0.9,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        background: 'rgba(255,255,255,0.85)',
        borderRadius: 3,
        padding: '1px 3px',
      }}>
        {person.name.split(' ')[0]}
      </div>
    </div>
  )
}
