import type { CSSProperties } from 'react'
import type { GridObject, ObjectKind } from '@shared/types'
import {
  Armchair,
  BedDouble,
  Sofa,
  Laptop,
  Toilet,
  Bath,
  UtensilsCrossed,
  Flower,
  Library,
  ChefHat,
  Archive,
  Flame,
  type LucideIcon,
} from 'lucide-react'

const OBJECT_ICONS: Record<ObjectKind, LucideIcon> = {
  chair: Armchair,
  bed: BedDouble,
  sofa: Sofa,
  desk: Laptop,
  toilet: Toilet,
  bathtub: Bath,
  table: UtensilsCrossed,
  plant: Flower,
  bookshelf: Library,
  counter: ChefHat,
  wardrobe: Archive,
  fireplace: Flame,
}

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
    userSelect: 'none',
    pointerEvents: 'none',
    opacity: object.occupiable === 'non-occupiable' ? 0.5 : 0.75,
    position: 'relative',
    zIndex: 2,
    gap: 2,
  }

  const Icon = OBJECT_ICONS[object.kind]
  const iconSize = Math.round(cellSize * 0.38)

  return (
    <div style={style}>
      <Icon size={iconSize} strokeWidth={1.5} color="rgba(0,0,0,0.7)" />
      <span style={{
        fontSize: cellSize * 0.11,
        color: 'rgba(0,0,0,0.45)',
        fontWeight: 600,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
      }}>
        {object.kind}
      </span>
    </div>
  )
}
