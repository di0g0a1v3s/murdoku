import type { CSSProperties } from 'react'

interface CellBorders {
	top: boolean
	right: boolean
	bottom: boolean
	left: boolean
}

interface CellProps {
	borders: CellBorders
	style?: CSSProperties
	onClick?: (e: React.MouseEvent) => void
}

const ROOM_BORDER = '3px solid rgba(0,0,0,0.6)'
const CELL_BORDER = '1px solid rgba(0,0,0,0.15)'

export function Cell({ borders, style, onClick }: CellProps) {
	return (
		<div
			onClick={onClick}
			style={{
				borderTop: borders.top ? ROOM_BORDER : CELL_BORDER,
				borderRight: borders.right ? ROOM_BORDER : CELL_BORDER,
				borderBottom: borders.bottom ? ROOM_BORDER : CELL_BORDER,
				borderLeft: borders.left ? ROOM_BORDER : CELL_BORDER,
				cursor: onClick ? 'pointer' : undefined,
				...style,
			}}
		/>
	)
}
