import { useMemo } from 'react';
import type { Coord, Person, Puzzle, Room, RoomPattern } from '@shared/types';
import { coordToKey } from '@shared/helpers';
import { Cell } from './Cell';
import { ObjectSprite } from './ObjectSprite';

const ROOM_ALPHA = '88'; // hex alpha for room tint

// Insert soft hyphens every 5 chars within each word so the browser breaks
// with a visible '-' when the label is too wide — works in all browsers.
function softHyphenate(name: string): string {
  return name
    .split(' ')
    .map((word) => (word.length > 5 ? word.match(/.{1,5}/g)!.join('\u00AD') : word))
    .join(' ');
}

function getCellBackground(pattern: RoomPattern): string {
  if (pattern.kind === 'solid') {
    return pattern.color + ROOM_ALPHA;
  }
  const a = pattern.colorA + ROOM_ALPHA;
  const b = pattern.colorB + ROOM_ALPHA;
  if (pattern.kind === 'striped') {
    // 4 equal horizontal bands alternating colorA / colorB
    return `linear-gradient(to right, ${a} 25%, ${b} 25%, ${b} 50%, ${a} 50%, ${a} 75%, ${b} 75%)`;
  }
  // checkered: 2×2 grid — TL+BR = colorA, TR+BL = colorB
  return [
    `linear-gradient(to right, ${a} 50%, ${b} 50%) top / 100% 50% no-repeat`,
    `linear-gradient(to right, ${b} 50%, ${a} 50%) bottom / 100% 50% no-repeat`,
  ].join(', ');
}

interface CellMarkProps {
  marks: Set<string>;
  cellKey: string;
  cellSize: number;
  people: Person[];
  committedCells?: Map<string, string>;
}

function CellMark({ marks, cellKey, cellSize, people, committedCells }: CellMarkProps) {
  const isX = marks.has('X');
  const personIds = [...marks].filter((m) => m !== 'X');
  const count = isX ? 1 : personIds.length;
  const fontSize = count <= 2 ? cellSize * 0.3 : count <= 4 ? cellSize * 0.23 : cellSize * 0.18;

  return (
    <div
      style={{
        width: cellSize,
        height: cellSize,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        alignContent: 'center',
        justifyContent: 'center',
        padding: 2,
        gap: 1,
      }}
    >
      {isX ? (
        <span
          style={{ fontSize: cellSize * 0.42, color: '#dc2626', fontWeight: 900, lineHeight: 1 }}
        >
          ✕
        </span>
      ) : (
        personIds.map((pid) => {
          const person = people.find((p) => p.id === pid);
          if (!person) {
            return null;
          }
          const letter = person.name[0].toUpperCase();
          const isCommitted = committedCells?.get(cellKey) === pid;
          const color = isCommitted ? '#15803d' : person.role === 'victim' ? '#dc2626' : '#7c3aed';
          return (
            <span
              key={pid}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                ...(isCommitted && {
                  border: '2px solid #15803d',
                  borderRadius: '50%',
                  width: fontSize * 2.5,
                  height: fontSize * 2.5,
                }),
              }}
            >
              <span style={{ fontSize, fontWeight: 700, color, lineHeight: 1 }}>{letter}</span>
            </span>
          );
        })
      )}
    </div>
  );
}

interface GridCanvasProps {
  puzzle: Puzzle;
  cellSize: number;
  cellMarks?: Map<string, Set<string>>;
  committedCells?: Map<string, string>;
  onCellClick?: (row: number, col: number, e: React.MouseEvent) => void;
}

function getRoomAt(coord: Coord, rooms: Room[]): Room | undefined {
  return rooms.find((r) => r.cells.some((c) => c.row === coord.row && c.col === coord.col));
}

export function GridCanvas({
  puzzle,
  cellSize,
  cellMarks,
  committedCells,
  onCellClick,
}: GridCanvasProps) {
  const { gridSize, rooms, objects, people } = puzzle;
  const { rows, cols } = gridSize;

  const nonOccupiable = useMemo(() => {
    const s = new Set<string>();
    for (const obj of objects) {
      if (obj.occupiable === 'non-occupiable') {
        for (const c of obj.cells) {
          s.add(coordToKey(c));
        }
      }
    }
    return s;
  }, [objects]);

  // Compute borders for each cell
  const cellBorders = useMemo(() => {
    return Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const coord = { row, col };
        const room = getRoomAt(coord, rooms);
        const topRoom = getRoomAt({ row: row - 1, col }, rooms);
        const rightRoom = getRoomAt({ row, col: col + 1 }, rooms);
        const bottomRoom = getRoomAt({ row: row + 1, col }, rooms);
        const leftRoom = getRoomAt({ row, col: col - 1 }, rooms);

        return {
          top: !topRoom || topRoom.id !== room?.id,
          right: !rightRoom || rightRoom.id !== room?.id,
          bottom: !bottomRoom || bottomRoom.id !== room?.id,
          left: !leftRoom || leftRoom.id !== room?.id,
        };
      }),
    );
  }, [rows, cols, rooms]);

  // Room label positions — largest consecutive horizontal span of empty cells
  const roomLabels = useMemo(() => {
    const objectCells = new Set(objects.flatMap((obj) => obj.cells.map(coordToKey)));
    return rooms.map((room) => {
      const byRow = new Map<number, number[]>();
      for (const c of room.cells) {
        const cs = byRow.get(c.row) ?? [];
        cs.push(c.col);
        byRow.set(c.row, cs);
      }

      let bestRow = room.cells[0]!.row;
      let bestCol = room.cells[0]!.col;
      let bestSpan = 0;

      for (const [r, cs] of byRow) {
        const sorted = [...cs].sort((a, b) => a - b);
        let runStart = 0;
        let runLen = 0;

        const endRun = () => {
          if (runLen > bestSpan || (runLen === bestSpan && r < bestRow)) {
            bestSpan = runLen;
            bestRow = r;
            bestCol = runStart;
          }
          runLen = 0;
        };

        for (let i = 0; i < sorted.length; i++) {
          const c = sorted[i]!;
          const empty = !objectCells.has(coordToKey({ row: r, col: c }));
          const consecutive = i > 0 && c === sorted[i - 1]! + 1;
          if (empty && (runLen === 0 || consecutive)) {
            if (runLen === 0) {
              runStart = c;
            }
            runLen++;
          } else {
            endRun();
            if (empty) {
              runStart = c;
              runLen = 1;
            }
          }
        }
        endRun();
      }

      // Fall back to any cell if room is fully covered by objects
      if (bestSpan === 0) {
        const first = [...byRow.entries()].sort(
          ([ra, ca], [rb, cb]) => cb.length - ca.length || ra - rb,
        )[0]!;
        bestRow = first[0];
        bestCol = Math.min(...first[1]);
        bestSpan = 1;
      }

      return { room, row: bestRow, col: bestCol, span: bestSpan };
    });
  }, [rooms, objects]);

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
    position: 'relative' as const,
    width: cellSize * cols,
    height: cellSize * rows,
    userSelect: 'none' as const,
  };

  return (
    <div style={gridStyle}>
      {/* Layer 1: Room background fills — regular grid items (no position:absolute to avoid double-offset) */}
      {rooms.map((room) =>
        room.cells.map((cell) => (
          <div
            key={`room-${room.id}-${cell.row}-${cell.col}`}
            style={{
              gridColumn: cell.col + 1,
              gridRow: cell.row + 1,
              background: getCellBackground(room.pattern),
              zIndex: 0,
            }}
          />
        )),
      )}

      {/* Layer 2: Room labels — position:absolute only (no gridColumn/gridRow to avoid double-offset) */}
      {roomLabels.map(({ room, row, col, span }) => (
        <div
          key={`label-${room.id}`}
          lang="en"
          style={{
            position: 'absolute' as const,
            left: col * cellSize + 4,
            top: row * cellSize + 3,
            maxWidth: span * cellSize - 8,
            fontSize: cellSize * 0.2,
            fontWeight: 700,
            color: 'rgba(0,0,0,0.45)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            zIndex: 1,
            pointerEvents: 'none',
            lineHeight: 1.2,
          }}
        >
          {softHyphenate(room.name)}
        </div>
      ))}

      {/* Layer 3: Cell borders + click targets */}
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => {
          const clickable = onCellClick && !nonOccupiable.has(coordToKey({ row, col }));
          return (
            <Cell
              key={`cell-${row}-${col}`}
              borders={cellBorders[row][col]}
              onClick={clickable ? (e) => onCellClick(row, col, e) : undefined}
              style={{
                gridColumn: col + 1,
                gridRow: row + 1,
                zIndex: 3,
                background: 'transparent',
              }}
            />
          );
        }),
      )}

      {/* Layer 4: Objects */}
      <div
        style={{
          ...gridStyle,
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        {objects.map((obj) => (
          <ObjectSprite key={obj.id} object={obj} cellSize={cellSize} />
        ))}
      </div>

      {/* Layer 4.5: Cell marks (player annotations) */}
      {cellMarks && cellMarks.size > 0 && (
        <div
          style={{
            ...gridStyle,
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 4,
          }}
        >
          {Array.from(cellMarks.entries()).map(([key, marks]) => {
            const [row, col] = key.split(',').map(Number);
            return (
              <div key={key} style={{ gridColumn: col + 1, gridRow: row + 1 }}>
                <CellMark
                  marks={marks}
                  cellKey={key}
                  cellSize={cellSize}
                  people={people}
                  committedCells={committedCells}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
