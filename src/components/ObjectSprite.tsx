import type { CSSProperties } from 'react';
import type { GridObject, ObjectKind } from '@shared/types';
import {
	Armchair,
	BedDouble,
	Sofa,
	Toilet,
	UtensilsCrossed,
	Flower,
	Library,
	ChefHat,
	Archive,
	Flame,
	type LucideIcon,
} from 'lucide-react';

const OBJECT_ICONS: Record<ObjectKind, LucideIcon> = {
	chair: Armchair,
	bed: BedDouble,
	sofa: Sofa,
	toilet: Toilet,
	table: UtensilsCrossed,
	plant: Flower,
	bookshelf: Library,
	counter: ChefHat,
	wardrobe: Archive,
	fireplace: Flame,
};

interface ObjectSpriteProps {
	object: GridObject;
	cellSize: number;
}

export function ObjectSprite({ object, cellSize }: ObjectSpriteProps) {
	const minRow = Math.min(...object.cells.map((c) => c.row));
	const minCol = Math.min(...object.cells.map((c) => c.col));
	const maxRow = Math.max(...object.cells.map((c) => c.row));
	const maxCol = Math.max(...object.cells.map((c) => c.col));

	const spanRows = maxRow - minRow + 1;
	const spanCols = maxCol - minCol + 1;
	const isWide = spanCols > spanRows; // e.g. sofa, table (2 cols × 1 row)
	const isTall = spanRows > spanCols; // e.g. bed (1 col × 2 rows)
	const isOccupiable = object.occupiable === 'occupiable';

	// Scale icon to make better use of the available span
	const iconSize = isTall
		? Math.round(Math.min(spanRows * cellSize * 0.28, cellSize * 0.58))
		: Math.round(cellSize * 0.38);

	const inset = Math.round(cellSize * 0.06);

	const style: CSSProperties = {
		gridColumn: `${minCol + 1} / span ${spanCols}`,
		gridRow: `${minRow + 1} / span ${spanRows}`,
		display: 'flex',
		flexDirection: isWide ? 'row' : 'column',
		alignItems: 'center',
		justifyContent: 'center',
		gap: isWide ? 5 : 2,
		margin: inset,
		borderRadius: Math.round(cellSize * 0.1),
		background: isOccupiable ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.07)',
		border: `1px solid ${isOccupiable ? 'rgba(0,0,0,0.13)' : 'rgba(0,0,0,0.08)'}`,
		userSelect: 'none',
		pointerEvents: 'none',
		zIndex: 2,
		overflow: 'hidden',
	};

	const Icon = OBJECT_ICONS[object.kind];
	const iconColor = isOccupiable ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)';

	return (
		<div style={style}>
			<Icon size={iconSize} strokeWidth={1.5} color={iconColor} />
			<span
				style={{
					fontSize: Math.round(cellSize * 0.126),
					color: isOccupiable ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)',
					fontWeight: 600,
					letterSpacing: '0.02em',
					textTransform: 'uppercase',
					lineHeight: 1,
					whiteSpace: 'nowrap',
				}}
			>
				{object.kind}
			</span>
		</div>
	);
}
