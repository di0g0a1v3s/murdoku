import type { CSSProperties } from 'react'
import type { GridObject } from '@shared/types'
import { OBJECT_EMOJI } from '@shared/types'

interface ObjectSpriteProps {
  object: GridObject
  cellSize: number
}

export function ObjectSprite({ object, cellSize }: ObjectSpriteProps) {
  const minRow = Math.min(...object.cells.map(c => c.row))
  const minCol = Math.min(...object.cells.map(c => c.col))
  const maxRow = Math.max(...object.cells.map(c => c.row))
  const maxCol = Math.max(...object.cells.map(c => c.col))

  const spanRows = maxRow - minRow + 1
  const spanCols = maxCol - minCol + 1

  const style: CSSProperties = {
    gridColumn: `${minCol + 1} / span ${spanCols}`,
    gridRow: `${minRow + 1} / span ${spanRows}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: cellSize * 0.38,
    userSelect: 'none',
    pointerEvents: 'none',
    opacity: object.occupiable === 'non-occupiable' ? 0.7 : 0.85,
    position: 'relative',
    zIndex: 2,
  }

  return (
    <div style={style}>
      <span style={{ lineHeight: 1 }}>{OBJECT_EMOJI[object.kind]}</span>
      <span style={{
        fontSize: cellSize * 0.11,
        color: 'rgba(0,0,0,0.5)',
        fontWeight: 600,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
        marginTop: 2,
      }}>
        {object.kind}
      </span>
    </div>
  )
}
