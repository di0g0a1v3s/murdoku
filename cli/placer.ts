import type { Coord, GridObject, Person, PlacedPerson } from '../shared/types.js';
import type { LayoutResult } from './layout-builder.js';

// ─── Latin-square backtracking placer ────────────────────────────────────────
// Finds a valid Latin-square placement for all N people (1/row, 1/col, no
// non-occupiable cells) where the victim's room has exactly 2 people.
// Exhaustively searches all Latin-square placements; returns null only if
// no valid placement exists for this layout.

function isNonOccupiable(coord: Coord, objects: GridObject[]): boolean {
	return objects.some(
		(obj) =>
			obj.occupiable === 'non-occupiable' &&
			obj.cells.some((c) => c.row === coord.row && c.col === coord.col),
	);
}

// Pseudo-random shuffle using simple LCG
function lcgShuffle<T>(arr: T[], seed: number): T[] {
	const a = [...arr];
	let s = seed;
	for (let i = a.length - 1; i > 0; i--) {
		s = (s * 1664525 + 1013904223) & 0xffffffff;
		const j = Math.abs(s) % (i + 1);
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export interface PlacerResult {
	placements: PlacedPerson[];
	murdererId: string;
	victimId: string;
	murderRoom: string;
}

export function placePeople(
	people: Person[],
	layout: LayoutResult,
	gridRows: number,
	gridCols: number,
	seed: number,
): PlacerResult | null {
	const { rooms, objects } = layout;

	const victimId = people.find((p) => p.role === 'victim')!.id;

	// Build O(1) coord→roomId lookup
	const coordToRoomId = new Map<string, string>();
	for (const room of rooms) {
		for (const cell of room.cells) {
			coordToRoomId.set(`${cell.row},${cell.col}`, room.id);
		}
	}

	const assignment = new Map<string, Coord>();
	const usedRows = new Set<number>();
	const usedCols = new Set<number>();

	const allCells: Coord[] = [];
	for (let r = 0; r < gridRows; r++) {
		for (let c = 0; c < gridCols; c++) {
			if (!isNonOccupiable({ row: r, col: c }, objects)) {
				allCells.push({ row: r, col: c });
			}
		}
	}

	const personOrder = lcgShuffle([...people], seed);
	const candidates = lcgShuffle(allCells, seed);
	// TODO: build victimCandidates: collection of cells belonging to rooms that can have 2 or more people

	function backtrack(personIndex: number): boolean {
		if (personIndex === personOrder.length) {
			// Murder condition: victim's room must have exactly 2 people
			const victimCoord = assignment.get(victimId)!;
			const victimRoom = coordToRoomId.get(`${victimCoord.row},${victimCoord.col}`)!;
			const count = [...assignment.values()].filter(
				(c) => coordToRoomId.get(`${c.row},${c.col}`) === victimRoom,
			).length;
			return count === 2;
		}

		const person = personOrder[personIndex]!;

		for (const coord of candidates) {
			if (usedRows.has(coord.row) || usedCols.has(coord.col)) {
				continue;
			}
			if (!coordToRoomId.has(`${coord.row},${coord.col}`)) {
				continue;
			}

			assignment.set(person.id, coord);
			usedRows.add(coord.row);
			usedCols.add(coord.col);

			if (backtrack(personIndex + 1)) {
				return true;
			}

			assignment.delete(person.id);
			usedRows.delete(coord.row);
			usedCols.delete(coord.col);
		}
		return false;
	}

	if (!backtrack(0)) {
		return null;
	}

	const victimCoord = assignment.get(victimId)!;
	const victimRoom = coordToRoomId.get(`${victimCoord.row},${victimCoord.col}`)!;
	const murdererId = [...assignment.entries()].find(
		([pid, c]) => pid !== victimId && coordToRoomId.get(`${c.row},${c.col}`) === victimRoom,
	)![0]!;

	const placements: PlacedPerson[] = people.map((p) => ({
		personId: p.id,
		coord: assignment.get(p.id)!,
	}));

	return { placements, murdererId, victimId, murderRoom: victimRoom };
}
