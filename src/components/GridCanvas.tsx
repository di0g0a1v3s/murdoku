import { useMemo } from 'react';
import type { Coord, Puzzle, Room } from '@shared/types';
import { Cell } from './Cell';
import { ObjectSprite } from './ObjectSprite';

interface GridCanvasProps {
	puzzle: Puzzle;
	cellSize: number;
	cellMarks?: Map<string, Set<string>>;
	onCellClick?: (row: number, col: number, e: React.MouseEvent) => void;
}

function getRoomAt(coord: Coord, rooms: Room[]): Room | undefined {
	return rooms.find((r) => r.cells.some((c) => c.row === coord.row && c.col === coord.col));
}

export function GridCanvas({ puzzle, cellSize, cellMarks, onCellClick }: GridCanvasProps) {
	const { gridSize, rooms, objects, people } = puzzle;
	const { rows, cols } = gridSize;

	const nonOccupiable = useMemo(() => {
		const s = new Set<string>();
		for (const obj of objects) {
			if (obj.occupiable === 'non-occupiable') {
				for (const c of obj.cells) {
					s.add(`${c.row},${c.col}`);
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

	// Room label positions — topmost-leftmost cell actually in the room
	const roomLabels = useMemo(() => {
		return rooms.map((room) => {
			const sorted = [...room.cells].sort((a, b) =>
				a.row !== b.row ? a.row - b.row : a.col - b.col,
			);
			const { row, col } = sorted[0]!;
			// Number of room cells in the label row at or right of the label column
			const spanInRow = room.cells.filter((c) => c.row === row && c.col >= col).length;
			return { room, row, col, spanInRow };
		});
	}, [rooms]);

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
							background: room.color + '55',
							zIndex: 0,
						}}
					/>
				)),
			)}

			{/* Layer 2: Room labels — position:absolute only (no gridColumn/gridRow to avoid double-offset) */}
			{roomLabels.map(({ room, row, col, spanInRow }) => (
				<div
					key={`label-${room.id}`}
					style={{
						position: 'absolute' as const,
						left: col * cellSize + 4,
						top: row * cellSize + 3,
						maxWidth: spanInRow * cellSize - 8,
						fontSize: cellSize * 0.2,
						fontWeight: 700,
						color: 'rgba(0,0,0,0.45)',
						textTransform: 'uppercase',
						letterSpacing: '0.04em',
						zIndex: 1,
						pointerEvents: 'none',
						wordBreak: 'break-word',
						lineHeight: 1.2,
					}}
				>
					{room.name}
				</div>
			))}

			{/* Layer 3: Cell borders + click targets */}
			{Array.from({ length: rows }, (_, row) =>
				Array.from({ length: cols }, (_, col) => {
					const clickable = onCellClick && !nonOccupiable.has(`${row},${col}`);
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
						const isX = marks.has('X');
						const personIds = [...marks].filter((m) => m !== 'X');
						const count = isX ? 1 : personIds.length;
						const fontSize =
							count <= 2 ? cellSize * 0.3 : count <= 4 ? cellSize * 0.23 : cellSize * 0.18;
						return (
							<div
								key={key}
								style={{
									gridColumn: col + 1,
									gridRow: row + 1,
									display: 'flex',
									flexWrap: 'wrap',
									alignItems: 'center',
									justifyContent: 'center',
									padding: 2,
									gap: 1,
								}}
							>
								{isX ? (
									<span
										style={{
											fontSize: cellSize * 0.42,
											color: '#dc2626',
											fontWeight: 900,
											lineHeight: 1,
										}}
									>
										✕
									</span>
								) : (
									personIds.map((pid) => {
										const person = people.find((p) => p.id === pid);
										if (!person) {
											return null;
										}
										return (
											<span
												key={pid}
												style={{
													fontSize,
													fontWeight: 700,
													color: person.role === 'victim' ? '#dc2626' : '#7c3aed',
													lineHeight: 1,
												}}
											>
												{person.name[0].toUpperCase()}
											</span>
										);
									})
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
