import { assertNever } from './types.js';
import type { Clue, Coord, GridObject, ObjectKind, Puzzle } from './types.js';

type EvalResult = 'satisfied' | 'violated' | 'unknown';

type Assignment = Map<string, Coord>;

// ─── Per-puzzle cache ─────────────────────────────────────────────────────────
//
// Built once per Puzzle object (WeakMap allows GC when puzzle is no longer
// referenced). Every evaluator uses these Maps for O(1) lookups instead of
// scanning puzzle.rooms / puzzle.objects on every call.

interface PuzzleCaches {
	coordToRoomId: Map<string, string>; // "r,c" → roomId
	coordToObjects: Map<string, GridObject[]>; // "r,c" → objects whose cells include this coord
	coordToAdjacentKinds: Map<string, Set<ObjectKind>>; // "r,c" → kinds of objects orthogonally adjacent in same room
	occupiableCoordToObj: Map<string, GridObject>; // "r,c" → occupiable object at coord (for object-occupancy)
}

const puzzleCacheMap = new WeakMap<Puzzle, PuzzleCaches>();

function buildCaches(puzzle: Puzzle): PuzzleCaches {
	const coordToRoomId = new Map<string, string>();
	for (const room of puzzle.rooms) {
		for (const cell of room.cells) {
			coordToRoomId.set(`${cell.row},${cell.col}`, room.id);
		}
	}

	const coordToObjects = new Map<string, GridObject[]>();
	const occupiableCoordToObj = new Map<string, GridObject>();
	for (const obj of puzzle.objects) {
		for (const cell of obj.cells) {
			const key = `${cell.row},${cell.col}`;
			const list = coordToObjects.get(key);
			if (list) {
				list.push(obj);
			} else {
				coordToObjects.set(key, [obj]);
			}
			if (obj.occupiable === 'occupiable') {
				occupiableCoordToObj.set(key, obj);
			}
		}
	}

	const coordToAdjacentKinds = new Map<string, Set<ObjectKind>>();
	for (const room of puzzle.rooms) {
		for (const cell of room.cells) {
			const key = `${cell.row},${cell.col}`;
			// Objects that occupy this cell are "on", not "adjacent" — exclude them
			const ownObjIds = new Set((coordToObjects.get(key) ?? []).map((o) => o.id));
			const kinds = new Set<ObjectKind>();
			const r = cell.row,
				c = cell.col;
			for (const nKey of [`${r - 1},${c}`, `${r + 1},${c}`, `${r},${c - 1}`, `${r},${c + 1}`]) {
				if (coordToRoomId.get(nKey) === room.id) {
					for (const obj of coordToObjects.get(nKey) ?? []) {
						if (!ownObjIds.has(obj.id)) {
							kinds.add(obj.kind);
						}
					}
				}
			}
			coordToAdjacentKinds.set(key, kinds);
		}
	}

	return { coordToRoomId, coordToObjects, coordToAdjacentKinds, occupiableCoordToObj };
}

function getCaches(puzzle: Puzzle): PuzzleCaches {
	let c = puzzleCacheMap.get(puzzle);
	if (!c) {
		c = buildCaches(puzzle);
		puzzleCacheMap.set(puzzle, c);
	}
	return c;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRoomId(coord: Coord, puzzle: Puzzle): string | undefined {
	return getCaches(puzzle).coordToRoomId.get(`${coord.row},${coord.col}`);
}

function getObjectsAtCoord(coord: Coord, puzzle: Puzzle): GridObject[] {
	return getCaches(puzzle).coordToObjects.get(`${coord.row},${coord.col}`) ?? [];
}

function getObjectsAdjacentInRoom(coord: Coord, puzzle: Puzzle): GridObject[] {
	const { coordToRoomId, coordToObjects } = getCaches(puzzle);
	const key = `${coord.row},${coord.col}`;
	const roomId = coordToRoomId.get(key);
	if (!roomId) {
		return [];
	}
	const ownObjIds = new Set((coordToObjects.get(key) ?? []).map((o) => o.id));
	const seen = new Set<string>();
	const result: GridObject[] = [];
	const r = coord.row,
		c = coord.col;
	for (const nKey of [`${r - 1},${c}`, `${r + 1},${c}`, `${r},${c - 1}`, `${r},${c + 1}`]) {
		if (coordToRoomId.get(nKey) === roomId) {
			for (const obj of coordToObjects.get(nKey) ?? []) {
				if (!ownObjIds.has(obj.id) && !seen.has(obj.id)) {
					seen.add(obj.id);
					result.push(obj);
				}
			}
		}
	}
	return result;
}

// Returns direction from A to B
function directionFromAToB(a: Coord, b: Coord): string {
	const rowDiff = b.row - a.row; // positive = B is south of A
	const colDiff = b.col - a.col; // positive = B is east of A

	if (rowDiff < 0 && colDiff === 0) {
		return 'N';
	}
	if (rowDiff > 0 && colDiff === 0) {
		return 'S';
	}
	if (rowDiff === 0 && colDiff > 0) {
		return 'E';
	}
	if (rowDiff === 0 && colDiff < 0) {
		return 'W';
	}
	if (rowDiff < 0 && colDiff > 0) {
		return 'NE';
	}
	if (rowDiff < 0 && colDiff < 0) {
		return 'NW';
	}
	if (rowDiff > 0 && colDiff > 0) {
		return 'SE';
	}
	if (rowDiff > 0 && colDiff < 0) {
		return 'SW';
	}
	return ''; // same cell
}

// Checks if A is in the given direction relative to B
// "A is N of B" means A.row < B.row (A is above B)
// "A is N of B" means A's row is above B's (any column); similarly for S/E/W.
// Diagonal directions (NE/NW/SE/SW) constrain both axes simultaneously.
function isInDirection(a: Coord, b: Coord, dir: string): boolean {
	switch (dir) {
		case 'N':
			return a.row < b.row;
		case 'S':
			return a.row > b.row;
		case 'E':
			return a.col > b.col;
		case 'W':
			return a.col < b.col;
		case 'NE':
			return a.row < b.row && a.col > b.col;
		case 'NW':
			return a.row < b.row && a.col < b.col;
		case 'SE':
			return a.row > b.row && a.col > b.col;
		case 'SW':
			return a.row > b.row && a.col < b.col;
		default:
			return false;
	}
}

// ─── Evaluators ───────────────────────────────────────────────────────────────

function evalPersonDirection(
	clue: Extract<Clue, { kind: 'person-direction' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const a = assignment.get(clue.personA);
	const b = assignment.get(clue.personB);
	if (a && b) {
		return isInDirection(a, b, clue.direction) ? 'satisfied' : 'violated';
	}
	const { rows, cols } = puzzle.gridSize;
	const dir = clue.direction;
	if (a) {
		// A placed, B not: violated if A's position leaves no valid cell for B
		if ((dir === 'N' || dir === 'NE' || dir === 'NW') && a.row >= rows - 1) {
			return 'violated';
		}
		if ((dir === 'S' || dir === 'SE' || dir === 'SW') && a.row <= 0) {
			return 'violated';
		}
		if ((dir === 'E' || dir === 'NE' || dir === 'SE') && a.col <= 0) {
			return 'violated';
		}
		if ((dir === 'W' || dir === 'NW' || dir === 'SW') && a.col >= cols - 1) {
			return 'violated';
		}
	} else if (b) {
		// B placed, A not: violated if B's position leaves no valid cell for A
		if ((dir === 'N' || dir === 'NE' || dir === 'NW') && b.row <= 0) {
			return 'violated';
		}
		if ((dir === 'S' || dir === 'SE' || dir === 'SW') && b.row >= rows - 1) {
			return 'violated';
		}
		if ((dir === 'E' || dir === 'NE' || dir === 'SE') && b.col >= cols - 1) {
			return 'violated';
		}
		if ((dir === 'W' || dir === 'NW' || dir === 'SW') && b.col <= 0) {
			return 'violated';
		}
	}
	return 'unknown';
}

function evalPersonDistance(
	clue: Extract<Clue, { kind: 'person-distance' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const a = assignment.get(clue.personA);
	const b = assignment.get(clue.personB);
	if (a && b) {
		if (clue.axis === 'col') {
			const diff = a.col - b.col;
			if (clue.direction === 'E' && diff === clue.distance) {
				return 'satisfied';
			}
			if (clue.direction === 'W' && diff === -clue.distance) {
				return 'satisfied';
			}
			return 'violated';
		} else {
			const diff = a.row - b.row;
			if (clue.direction === 'N' && diff === -clue.distance) {
				return 'satisfied';
			}
			if (clue.direction === 'S' && diff === clue.distance) {
				return 'satisfied';
			}
			return 'violated';
		}
	}
	const { rows, cols } = puzzle.gridSize;
	const { axis, direction, distance } = clue;
	if (a) {
		// Only A placed: violated if the required B position would be out of bounds
		// 'E': A.col - B.col = distance  → B.col = A.col - distance
		// 'W': A.col - B.col = -distance → B.col = A.col + distance
		// 'N': A.row - B.row = -distance → B.row = A.row + distance
		// 'S': A.row - B.row = distance  → B.row = A.row - distance
		if (axis === 'col') {
			if (direction === 'E' && a.col < distance) {
				return 'violated';
			}
			if (direction === 'W' && a.col > cols - 1 - distance) {
				return 'violated';
			}
		} else {
			if (direction === 'N' && a.row > rows - 1 - distance) {
				return 'violated';
			}
			if (direction === 'S' && a.row < distance) {
				return 'violated';
			}
		}
	} else if (b) {
		// Only B placed: violated if the required A position would be out of bounds
		if (axis === 'col') {
			if (direction === 'E' && b.col > cols - 1 - distance) {
				return 'violated';
			}
			if (direction === 'W' && b.col < distance) {
				return 'violated';
			}
		} else {
			if (direction === 'N' && b.row < distance) {
				return 'violated';
			}
			if (direction === 'S' && b.row > rows - 1 - distance) {
				return 'violated';
			}
		}
	}
	return 'unknown';
}

function evalPersonBesideObject(
	clue: Extract<Clue, { kind: 'person-beside-object' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const coord = assignment.get(clue.person);
	if (!coord) {
		return 'unknown';
	}
	const kinds = getCaches(puzzle).coordToAdjacentKinds.get(`${coord.row},${coord.col}`);
	return kinds?.has(clue.objectKind) ? 'satisfied' : 'violated';
}

function evalPersonOnObject(
	clue: Extract<Clue, { kind: 'person-on-object' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const coord = assignment.get(clue.person);
	if (!coord) {
		return 'unknown';
	}
	const objs = getCaches(puzzle).coordToObjects.get(`${coord.row},${coord.col}`) ?? [];
	return objs.some((o) => o.kind === clue.objectKind) ? 'satisfied' : 'violated';
}

function evalPersonInRoom(
	clue: Extract<Clue, { kind: 'person-in-room' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const coord = assignment.get(clue.person);
	if (!coord) {
		return 'unknown';
	}
	return getCaches(puzzle).coordToRoomId.get(`${coord.row},${coord.col}`) === clue.roomId
		? 'satisfied'
		: 'violated';
}

function evalPersonsSameRoom(
	clue: Extract<Clue, { kind: 'persons-same-room' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const a = assignment.get(clue.personA);
	const b = assignment.get(clue.personB);
	if (!a || !b) {
		return 'unknown';
	}
	const { coordToRoomId } = getCaches(puzzle);
	const ra = coordToRoomId.get(`${a.row},${a.col}`);
	const rb = coordToRoomId.get(`${b.row},${b.col}`);
	if (!ra || !rb) {
		return 'unknown';
	}
	return ra === rb ? 'satisfied' : 'violated';
}

function evalPersonAloneInRoom(
	clue: Extract<Clue, { kind: 'person-alone-in-room' }>,
	assignment: Assignment,
	puzzle: Puzzle,
	allPersonIds: string[],
): EvalResult {
	const { coordToRoomId } = getCaches(puzzle);
	for (const [pid, c] of assignment) {
		if (pid === clue.person) {
			continue;
		}
		if (coordToRoomId.get(`${c.row},${c.col}`) === clue.roomId) {
			return 'violated';
		}
	}
	const coord = assignment.get(clue.person);
	if (!coord) {
		return 'unknown';
	}
	if (coordToRoomId.get(`${coord.row},${coord.col}`) !== clue.roomId) {
		return 'violated';
	}
	if (assignment.size === allPersonIds.length) {
		return 'satisfied';
	}
	return 'unknown';
}

function evalRoomPopulation(
	clue: Extract<Clue, { kind: 'room-population' }>,
	assignment: Assignment,
	puzzle: Puzzle,
	allPersonIds: string[],
): EvalResult {
	const { coordToRoomId } = getCaches(puzzle);
	let countInRoom = 0;
	for (const [, c] of assignment) {
		if (coordToRoomId.get(`${c.row},${c.col}`) === clue.roomId) {
			countInRoom++;
		}
	}
	if (countInRoom > clue.count) {
		return 'violated';
	}
	if (assignment.size === allPersonIds.length) {
		return countInRoom === clue.count ? 'satisfied' : 'violated';
	}
	return 'unknown';
}

function evalObjectOccupancy(
	clue: Extract<Clue, { kind: 'object-occupancy' }>,
	assignment: Assignment,
	puzzle: Puzzle,
	allPersonIds: string[],
): EvalResult {
	const { occupiableCoordToObj } = getCaches(puzzle);
	const occupiedObjIds = new Set<string>();
	for (const [, c] of assignment) {
		const obj = occupiableCoordToObj.get(`${c.row},${c.col}`);
		if (obj && obj.kind === clue.objectKind) {
			occupiedObjIds.add(obj.id);
		}
	}
	const occupiedCount = occupiedObjIds.size;
	if (occupiedCount > clue.count) {
		return 'violated';
	}
	if (assignment.size === allPersonIds.length) {
		return occupiedCount === clue.count ? 'satisfied' : 'violated';
	}
	return 'unknown';
}

function evalPersonNotInRoom(
	clue: Extract<Clue, { kind: 'person-not-in-room' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const coord = assignment.get(clue.person);
	if (!coord) {
		return 'unknown';
	}
	return getCaches(puzzle).coordToRoomId.get(`${coord.row},${coord.col}`) !== clue.roomId
		? 'satisfied'
		: 'violated';
}

function evalPersonsNotSameRoom(
	clue: Extract<Clue, { kind: 'persons-not-same-room' }>,
	assignment: Assignment,
	puzzle: Puzzle,
): EvalResult {
	const a = assignment.get(clue.personA);
	const b = assignment.get(clue.personB);
	if (!a || !b) {
		return 'unknown';
	}
	const { coordToRoomId } = getCaches(puzzle);
	const ra = coordToRoomId.get(`${a.row},${a.col}`);
	const rb = coordToRoomId.get(`${b.row},${b.col}`);
	if (!ra || !rb) {
		return 'unknown';
	}
	return ra !== rb ? 'satisfied' : 'violated';
}

function evalPersonInRoomWith(
	clue: Extract<Clue, { kind: 'person-in-room-with' }>,
	assignment: Assignment,
	puzzle: Puzzle,
	allPersonIds: string[],
): EvalResult {
	const { coordToRoomId } = getCaches(puzzle);
	const coord = assignment.get(clue.person);
	if (!coord) {
		return 'unknown';
	}
	const roomId = coordToRoomId.get(`${coord.row},${coord.col}`);
	if (!roomId) {
		return 'unknown';
	}
	let othersInRoom = 0;
	for (const [pid, c] of assignment) {
		if (pid === clue.person) {
			continue;
		}
		if (coordToRoomId.get(`${c.row},${c.col}`) === roomId) {
			othersInRoom++;
		}
	}
	if (othersInRoom > clue.count) {
		return 'violated';
	}
	if (assignment.size === allPersonIds.length) {
		return othersInRoom === clue.count ? 'satisfied' : 'violated';
	}
	return 'unknown';
}

// ─── Main Evaluator ───────────────────────────────────────────────────────────

export function evaluateClue(clue: Clue, assignment: Assignment, puzzle: Puzzle): EvalResult {
	const allPersonIds = puzzle.people.map((p) => p.id);
	switch (clue.kind) {
		case 'person-direction':
			return evalPersonDirection(clue, assignment, puzzle);
		case 'person-distance':
			return evalPersonDistance(clue, assignment, puzzle);
		case 'person-beside-object':
			return evalPersonBesideObject(clue, assignment, puzzle);
		case 'person-on-object':
			return evalPersonOnObject(clue, assignment, puzzle);
		case 'person-in-room':
			return evalPersonInRoom(clue, assignment, puzzle);
		case 'persons-same-room':
			return evalPersonsSameRoom(clue, assignment, puzzle);
		case 'person-alone-in-room':
			return evalPersonAloneInRoom(clue, assignment, puzzle, allPersonIds);
		case 'room-population':
			return evalRoomPopulation(clue, assignment, puzzle, allPersonIds);
		case 'object-occupancy':
			return evalObjectOccupancy(clue, assignment, puzzle, allPersonIds);
		case 'person-not-in-room':
			return evalPersonNotInRoom(clue, assignment, puzzle);
		case 'persons-not-same-room':
			return evalPersonsNotSameRoom(clue, assignment, puzzle);
		case 'person-in-room-with':
			return evalPersonInRoomWith(clue, assignment, puzzle, allPersonIds);
		default:
			return assertNever(clue);
	}
}

export { getRoomId, getObjectsAtCoord, getObjectsAdjacentInRoom, directionFromAToB };
