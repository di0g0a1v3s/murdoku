import { useMemo } from 'react'
import type { Coord, Puzzle, Room } from '@shared/types'
import { Cell } from './Cell'
import { ObjectSprite } from './ObjectSprite'
import { PersonToken } from './PersonToken'

interface GridCanvasProps {
  puzzle: Puzzle
  showSolution: boolean
  cellSize: number
}

function getRoomAt(coord: Coord, rooms: Room[]): Room | undefined {
  return rooms.find(r => r.cells.some(c => c.row === coord.row && c.col === coord.col))
}

export function GridCanvas({ puzzle, showSolution, cellSize }: GridCanvasProps) {
  const { gridSize, rooms, objects, people, solution } = puzzle
  const { rows, cols } = gridSize

  // Compute borders for each cell
  const cellBorders = useMemo(() => {
    return Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const coord = { row, col }
        const room = getRoomAt(coord, rooms)
        const topRoom = getRoomAt({ row: row - 1, col }, rooms)
        const rightRoom = getRoomAt({ row, col: col + 1 }, rooms)
        const bottomRoom = getRoomAt({ row: row + 1, col }, rooms)
        const leftRoom = getRoomAt({ row, col: col - 1 }, rooms)

        return {
          top: !topRoom || topRoom.id !== room?.id,
          right: !rightRoom || rightRoom.id !== room?.id,
          bottom: !bottomRoom || bottomRoom.id !== room?.id,
          left: !leftRoom || leftRoom.id !== room?.id,
        }
      })
    )
  }, [rows, cols, rooms])

  // Room label positions (top-left cell of bounding box per room)
  const roomLabels = useMemo(() => {
    return rooms.map(room => {
      const minRow = Math.min(...room.cells.map(c => c.row))
      const minCol = Math.min(...room.cells.map(c => c.col))
      return { room, row: minRow, col: minCol }
    })
  }, [rooms])

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
    position: 'relative' as const,
    width: cellSize * cols,
    height: cellSize * rows,
    userSelect: 'none' as const,
  }

  return (
    <div style={gridStyle}>
      {/* Layer 1: Room background fills — regular grid items (no position:absolute to avoid double-offset) */}
      {rooms.map(room =>
        room.cells.map(cell => (
          <div
            key={`room-${room.id}-${cell.row}-${cell.col}`}
            style={{
              gridColumn: cell.col + 1,
              gridRow: cell.row + 1,
              background: room.color + '55',
              zIndex: 0,
            }}
          />
        ))
      )}

      {/* Layer 2: Room labels — position:absolute only (no gridColumn/gridRow to avoid double-offset) */}
      {roomLabels.map(({ room, row, col }) => (
        <div
          key={`label-${room.id}`}
          style={{
            position: 'absolute' as const,
            left: col * cellSize + 4,
            top: row * cellSize + 3,
            fontSize: cellSize * 0.155,
            fontWeight: 700,
            color: 'rgba(0,0,0,0.45)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            zIndex: 1,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            lineHeight: 1,
          }}
        >
          {room.name}
        </div>
      ))}

      {/* Layer 3: Cell borders (drawn as grid items) */}
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => (
          <Cell
            key={`cell-${row}-${col}`}
            borders={cellBorders[row][col]}
            style={{
              gridColumn: col + 1,
              gridRow: row + 1,
              zIndex: 3,
              background: 'transparent',
            }}
          />
        ))
      )}

      {/* Layer 4: Objects */}
      <div style={{
        ...gridStyle,
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 2,
      }}>
        {objects.map(obj => (
          <ObjectSprite key={obj.id} object={obj} cellSize={cellSize} />
        ))}
      </div>

      {/* Layer 5: Person tokens (shown when solution revealed) */}
      {showSolution && (
        <div style={{
          ...gridStyle,
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}>
          {solution.placements.map(p => {
            const person = people.find(pe => pe.id === p.personId)!
            return (
              <PersonToken
                key={p.personId}
                person={person}
                row={p.coord.row}
                col={p.coord.col}
                cellSize={cellSize}
                isVictim={p.personId === solution.victimId}
                isMurderer={p.personId === solution.murdererId}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
