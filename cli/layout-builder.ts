import type { Coord, GridObject, ObjectKind, Room } from '../shared/types.js'
import { OBJECT_KIND_VALUES, OBJECT_OCCUPIABILITY } from '../shared/types.js'
import type { PuzzleTheme } from './llm-client.js'

// ─── Room partitioning via Voronoi BFS ────────────────────────────────────────

function shuffle<T>(arr: T[], rng: () => number): T[] {
	const a = [...arr]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

// Simple seeded PRNG (Mulberry32)
function makePrng(seed: number): () => number {
	let s = seed
	return () => {
		s |= 0
		s = (s + 0x6d2b79f5) | 0
		let t = Math.imul(s ^ (s >>> 15), 1 | s)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export function buildRooms(
	theme: PuzzleTheme,
	seed: number,
	gridRows: number,
	gridCols: number,
): Room[] {
	const rng = makePrng(seed)
	const numRooms = theme.rooms.length

	// One seed per room (preserves contiguity)
	const allCells: Coord[] = []
	for (let r = 0; r < gridRows; r++) {
		for (let c = 0; c < gridCols; c++) {
			allCells.push({ row: r, col: c })
		}
	}

	const shuffled = shuffle(allCells, rng)
	const seedCoords = shuffled.slice(0, numRooms)

	// Weighted BFS — each step expands the room most behind its size target.
	// This keeps rooms contiguous while approximating sizePercentage proportions.
	const assignment: (number | null)[][] = Array.from({ length: gridRows }, () =>
		Array(gridCols).fill(null),
	)
	const roomQueues: Coord[][] = Array.from({ length: numRooms }, () => [])
	const roomHeads = new Array<number>(numRooms).fill(0)
	const roomSizes = new Array<number>(numRooms).fill(0)

	seedCoords.forEach((coord, i) => {
		assignment[coord.row][coord.col] = i
		roomQueues[i].push(coord)
		roomSizes[i] = 1
	})

	const totalWeight = theme.rooms.reduce((s, r) => s + r.sizePercentage, 0)
	const roomWeights = theme.rooms.map((r) => r.sizePercentage / totalWeight)

	const neighbors = (c: Coord): Coord[] =>
		[
			{ row: c.row - 1, col: c.col },
			{ row: c.row + 1, col: c.col },
			{ row: c.row, col: c.col - 1 },
			{ row: c.row, col: c.col + 1 },
		].filter((n) => n.row >= 0 && n.row < gridRows && n.col >= 0 && n.col < gridCols)

	while (true) {
		// Pick the room most underrepresented relative to its target weight
		const totalClaimed = roomSizes.reduce((a, b) => a + b, 0)
		let nextRoom = -1
		let bestDeficit = -Infinity
		for (let i = 0; i < numRooms; i++) {
			if (roomHeads[i] >= roomQueues[i].length) {
				continue
			}
			const deficit = roomWeights[i]! - roomSizes[i]! / totalClaimed
			if (deficit > bestDeficit) {
				bestDeficit = deficit
				nextRoom = i
			}
		}
		if (nextRoom === -1) {
			break
		}

		const coord = roomQueues[nextRoom][roomHeads[nextRoom]++]!
		for (const n of shuffle(neighbors(coord), rng)) {
			if (assignment[n.row][n.col] === null) {
				assignment[n.row][n.col] = nextRoom
				roomQueues[nextRoom].push(n)
				roomSizes[nextRoom]++
			}
		}
	}

	// Build Room objects
	return theme.rooms.map((r, i) => ({
		id: r.id,
		name: r.name,
		color: r.color,
		cells: allCells.filter((c) => assignment[c.row][c.col] === i),
	}))
}

// ─── Object placement ─────────────────────────────────────────────────────────

// Objects pool: kind + cell pattern (offsets from anchor)
interface ObjectTemplate {
	kind: ObjectKind
	offsets: Coord[] // relative offsets from anchor cell
	minFreeAdjacent: number // min free in-room cells adjacent to the object after placement
	mustTouchWall: boolean // at least one cell must border the room boundary or grid edge
}

const OBJECT_OFFSETS: Record<ObjectKind, Coord[]> = {
	chair: [{ row: 0, col: 0 }],
	plant: [{ row: 0, col: 0 }],
	table: [
		{ row: 0, col: 0 },
		{ row: 0, col: 1 },
	],
	bed: [
		{ row: 0, col: 0 },
		{ row: 1, col: 0 },
	],
	bookshelf: [{ row: 0, col: 0 }],
	sofa: [
		{ row: 0, col: 0 },
		{ row: 0, col: 1 },
	],
	fireplace: [{ row: 0, col: 0 }],
	counter: [
		{ row: 0, col: 0 },
		{ row: 0, col: 1 },
	],
	wardrobe: [{ row: 0, col: 0 }],
	toilet: [{ row: 0, col: 0 }],
}

// Minimum number of free in-room cells adjacent to the object after placement.
// Occupiable objects and service objects need at least one open approach cell.
// Decorative / wall-mounted objects can be tucked into a corner.
const OBJECT_MIN_FREE_ADJACENT: Record<ObjectKind, number> = {
	chair: 1, // must be reachable
	plant: 0, // decorative corner piece
	table: 1, // need space to pull up a chair
	bed: 1, // need space to get in/out
	bookshelf: 0, // against a wall
	sofa: 1, // must be approachable
	fireplace: 0, // wall-mounted
	counter: 1, // service space in front
	wardrobe: 0, // against a wall
	toilet: 1, // must be approachable
}

// Objects that structurally belong against a room boundary or grid edge.
const OBJECT_MUST_TOUCH_WALL: Record<ObjectKind, boolean> = {
	chair: false,
	plant: false,
	table: false,
	bed: true, // always against a wall
	bookshelf: true, // always against a wall
	sofa: false, // can face into the room
	fireplace: true, // structurally in a wall
	counter: true, // against a wall
	wardrobe: true, // against a wall
	toilet: true, // always against a wall
}

const OBJECT_TEMPLATES: ObjectTemplate[] = OBJECT_KIND_VALUES.map((kind) => ({
	kind,
	offsets: OBJECT_OFFSETS[kind],
	minFreeAdjacent: OBJECT_MIN_FREE_ADJACENT[kind],
	mustTouchWall: OBJECT_MUST_TOUCH_WALL[kind],
}))

// TODO: allow rotation
function getCellsForTemplate(anchor: Coord, template: ObjectTemplate): Coord[] {
	return template.offsets.map((o) => ({ row: anchor.row + o.row, col: anchor.col + o.col }))
}

function cellsInRoom(cells: Coord[], room: Room): boolean {
	return cells.every((c) => room.cells.some((rc) => rc.row === c.row && rc.col === c.col))
}

function cellsNotOccupied(cells: Coord[], usedCells: Set<string>): boolean {
	return cells.every((c) => !usedCells.has(`${c.row},${c.col}`))
}

function touchesWall(cells: Coord[], room: Room, gridRows: number, gridCols: number): boolean {
	const roomKeys = new Set(room.cells.map((c) => `${c.row},${c.col}`))
	for (const cell of cells) {
		for (const n of [
			{ row: cell.row - 1, col: cell.col },
			{ row: cell.row + 1, col: cell.col },
			{ row: cell.row, col: cell.col - 1 },
			{ row: cell.row, col: cell.col + 1 },
		]) {
			// Out of grid bounds or belongs to a different room — that's a wall
			if (n.row < 0 || n.row >= gridRows || n.col < 0 || n.col >= gridCols) {
				return true
			}
			if (!roomKeys.has(`${n.row},${n.col}`)) {
				return true
			}
		}
	}
	return false
}

function hasFreeAdjacent(
	cells: Coord[],
	room: Room,
	usedCells: Set<string>,
	minFree: number,
): boolean {
	if (minFree === 0) {
		return true
	}
	const objectKeys = new Set(cells.map((c) => `${c.row},${c.col}`))
	const free = new Set<string>()
	for (const cell of cells) {
		for (const n of [
			{ row: cell.row - 1, col: cell.col },
			{ row: cell.row + 1, col: cell.col },
			{ row: cell.row, col: cell.col - 1 },
			{ row: cell.row, col: cell.col + 1 },
		]) {
			const key = `${n.row},${n.col}`
			if (objectKeys.has(key)) {
				continue
			}
			if (usedCells.has(key)) {
				continue
			}
			if (!room.cells.some((rc) => rc.row === n.row && rc.col === n.col)) {
				continue
			}
			free.add(key)
		}
	}
	return free.size >= minFree
}

export interface LayoutResult {
	rooms: Room[]
	objects: GridObject[]
}

export function buildLayout(
	theme: PuzzleTheme,
	seed: number,
	gridRows: number,
	gridCols: number,
): LayoutResult {
	const rng = makePrng(seed + 1000)
	const rooms = buildRooms(theme, seed, gridRows, gridCols)

	const objects: GridObject[] = []
	const usedCells = new Set<string>()

	// Place objects in room
	for (let roomIdx = 0; roomIdx < rooms.length; roomIdx++) {
		const room = rooms[roomIdx]!
		const allowed = theme.rooms[roomIdx]?.allowedObjects ?? []
		const required = theme.rooms[roomIdx]?.requiredObjects ?? []

		// Required objects first, then optional — fall back to all templates if allowed is empty
		const requiredTemplates = shuffle(
			OBJECT_TEMPLATES.filter((t) => required.includes(t.kind)),
			rng,
		)
		const optionalTemplates = shuffle(
			allowed.length > 0
				? OBJECT_TEMPLATES.filter((t) => allowed.includes(t.kind) && !required.includes(t.kind))
				: OBJECT_TEMPLATES.filter((t) => !required.includes(t.kind)),
			rng,
		)
		const orderedTemplates = [...requiredTemplates, ...optionalTemplates]
		const numObjects = Math.max(required.length, Math.floor(rng() * 2) + 1)
		let placed = 0
		const placedKinds = new Set<ObjectKind>()

		// For each slot: try templates in priority order (required first), pick the first that fits.
		// Iterating by slot (not by template) means the same kind can be placed multiple times.
		while (placed < numObjects) {
			let placedOne = false
			for (const template of orderedTemplates) {
				const roomCells = shuffle([...room.cells], rng)
				for (const anchor of roomCells) {
					const cells = getCellsForTemplate(anchor, template)
					if (
						cellsInRoom(cells, room) &&
						cellsNotOccupied(cells, usedCells) &&
						hasFreeAdjacent(cells, room, usedCells, template.minFreeAdjacent) &&
						(!template.mustTouchWall || touchesWall(cells, room, gridRows, gridCols))
					) {
						const id = `${template.kind}-${room.id}-${placed + 1}`
						objects.push({
							id,
							kind: template.kind,
							occupiable: OBJECT_OCCUPIABILITY[template.kind],
							cells,
						})
						cells.forEach((c) => usedCells.add(`${c.row},${c.col}`))
						placed++
						placedKinds.add(template.kind)
						placedOne = true
						break
					}
				}
				if (placedOne) {
					break
				}
			}
			if (!placedOne) {
				break
			} // no template fits anywhere in this room — stop
		}

		// Every required object must have been placed — otherwise this layout is invalid
		for (const req of required) {
			if (!placedKinds.has(req)) {
				throw new Error(`Required object '${req}' could not be placed in room '${room.name}'`)
			}
		}
	}

	return { rooms, objects }
}

// ─── Occupiable cell validation ───────────────────────────────────────────────

export function getOccupiableCells(rooms: Room[], objects: GridObject[]): Coord[] {
	const nonOccupiableCells = new Set<string>()
	for (const obj of objects) {
		if (obj.occupiable === 'non-occupiable') {
			obj.cells.forEach((c) => nonOccupiableCells.add(`${c.row},${c.col}`))
		}
	}

	const result: Coord[] = []
	for (const room of rooms) {
		for (const cell of room.cells) {
			if (!nonOccupiableCells.has(`${cell.row},${cell.col}`)) {
				result.push(cell)
			}
		}
	}
	return result
}

export function hasEnoughOccupiableCells(
	rooms: Room[],
	objects: GridObject[],
	needed: number,
): boolean {
	const occupiable = getOccupiableCells(rooms, objects)
	// Must have at least one occupiable cell per row and per column
	const rows = new Set(occupiable.map((c) => c.row))
	const cols = new Set(occupiable.map((c) => c.col))
	return rows.size >= needed && cols.size >= needed
}
