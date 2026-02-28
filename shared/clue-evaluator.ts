import type { Clue, Coord, GridObject, Puzzle } from './types.js'

type EvalResult = 'satisfied' | 'violated' | 'unknown'

type Assignment = Map<string, Coord>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRoomId(coord: Coord, puzzle: Puzzle): string | undefined {
  return puzzle.rooms.find(r =>
    r.cells.some(c => c.row === coord.row && c.col === coord.col)
  )?.id
}

function getObjectsAtCoord(coord: Coord, puzzle: Puzzle): GridObject[] {
  return puzzle.objects.filter(o =>
    o.cells.some(c => c.row === coord.row && c.col === coord.col)
  )
}

function getObjectsAdjacentInRoom(coord: Coord, puzzle: Puzzle): GridObject[] {
  const roomId = getRoomId(coord, puzzle)
  if (!roomId) return []
  const neighbors: Coord[] = [
    { row: coord.row - 1, col: coord.col },
    { row: coord.row + 1, col: coord.col },
    { row: coord.row, col: coord.col - 1 },
    { row: coord.row, col: coord.col + 1 },
  ]
  return puzzle.objects.filter(obj =>
    obj.cells.some(cell => {
      const inRoom = getRoomId(cell, puzzle) === roomId
      return inRoom && neighbors.some(n => n.row === cell.row && n.col === cell.col)
    })
  )
}

// Returns direction from A to B
function directionFromAToB(a: Coord, b: Coord): string {
  const rowDiff = b.row - a.row // positive = B is south of A
  const colDiff = b.col - a.col // positive = B is east of A

  if (rowDiff < 0 && colDiff === 0) return 'N'
  if (rowDiff > 0 && colDiff === 0) return 'S'
  if (rowDiff === 0 && colDiff > 0) return 'E'
  if (rowDiff === 0 && colDiff < 0) return 'W'
  if (rowDiff < 0 && colDiff > 0) return 'NE'
  if (rowDiff < 0 && colDiff < 0) return 'NW'
  if (rowDiff > 0 && colDiff > 0) return 'SE'
  if (rowDiff > 0 && colDiff < 0) return 'SW'
  return '' // same cell
}

// Checks if A is in the given direction relative to B
// "A is N of B" means A.row < B.row (A is above B)
function isInDirection(a: Coord, b: Coord, dir: string): boolean {
  switch (dir) {
    case 'N': return a.row < b.row && a.col === b.col
    case 'S': return a.row > b.row && a.col === b.col
    case 'E': return a.col > b.col && a.row === b.row
    case 'W': return a.col < b.col && a.row === b.row
    case 'NE': return a.row < b.row && a.col > b.col
    case 'NW': return a.row < b.row && a.col < b.col
    case 'SE': return a.row > b.row && a.col > b.col
    case 'SW': return a.row > b.row && a.col < b.col
    default: return false
  }
}

// ─── Evaluators ───────────────────────────────────────────────────────────────

function evalPersonDirection(
  clue: Extract<Clue, { kind: 'person-direction' }>,
  assignment: Assignment,
): EvalResult {
  const a = assignment.get(clue.personA)
  const b = assignment.get(clue.personB)
  if (!a || !b) return 'unknown'
  return isInDirection(a, b, clue.direction) ? 'satisfied' : 'violated'
}

function evalPersonDistance(
  clue: Extract<Clue, { kind: 'person-distance' }>,
  assignment: Assignment,
): EvalResult {
  const a = assignment.get(clue.personA)
  const b = assignment.get(clue.personB)
  if (!a || !b) return 'unknown'

  if (clue.axis === 'col') {
    const correctAxis = a.row === b.row
    if (!correctAxis) return 'violated'
    const diff = a.col - b.col
    if (clue.direction === 'E' && diff === clue.distance) return 'satisfied'
    if (clue.direction === 'W' && diff === -clue.distance) return 'satisfied'
    return 'violated'
  } else {
    const correctAxis = a.col === b.col
    if (!correctAxis) return 'violated'
    const diff = a.row - b.row
    if (clue.direction === 'N' && diff === -clue.distance) return 'satisfied'
    if (clue.direction === 'S' && diff === clue.distance) return 'satisfied'
    return 'violated'
  }
}

function evalPersonBesideObject(
  clue: Extract<Clue, { kind: 'person-beside-object' }>,
  assignment: Assignment,
  puzzle: Puzzle,
): EvalResult {
  const coord = assignment.get(clue.person)
  if (!coord) return 'unknown'
  const adjacent = getObjectsAdjacentInRoom(coord, puzzle)
  return adjacent.some(o => o.kind === clue.objectKind) ? 'satisfied' : 'violated'
}

function evalPersonOnObject(
  clue: Extract<Clue, { kind: 'person-on-object' }>,
  assignment: Assignment,
  puzzle: Puzzle,
): EvalResult {
  const coord = assignment.get(clue.person)
  if (!coord) return 'unknown'
  const objects = getObjectsAtCoord(coord, puzzle)
  return objects.some(o => o.kind === clue.objectKind) ? 'satisfied' : 'violated'
}

function evalPersonInRoom(
  clue: Extract<Clue, { kind: 'person-in-room' }>,
  assignment: Assignment,
  puzzle: Puzzle,
): EvalResult {
  const coord = assignment.get(clue.person)
  if (!coord) return 'unknown'
  return getRoomId(coord, puzzle) === clue.roomId ? 'satisfied' : 'violated'
}

function evalPersonsSameRoom(
  clue: Extract<Clue, { kind: 'persons-same-room' }>,
  assignment: Assignment,
  puzzle: Puzzle,
): EvalResult {
  const a = assignment.get(clue.personA)
  const b = assignment.get(clue.personB)
  if (!a || !b) return 'unknown'
  const ra = getRoomId(a, puzzle)
  const rb = getRoomId(b, puzzle)
  if (!ra || !rb) return 'unknown'
  return ra === rb ? 'satisfied' : 'violated'
}

function evalPersonAloneInRoom(
  clue: Extract<Clue, { kind: 'person-alone-in-room' }>,
  assignment: Assignment,
  puzzle: Puzzle,
  allPersonIds: string[],
): EvalResult {
  const coord = assignment.get(clue.person)
  if (!coord) return 'unknown'
  const roomId = getRoomId(coord, puzzle)
  if (!roomId) return 'unknown'

  // Count how many assigned people are in the same room
  let count = 0
  for (const [, c] of assignment) {
    if (getRoomId(c, puzzle) === roomId) count++
  }

  const totalPeople = allPersonIds.length
  const assignedCount = assignment.size

  if (count > 1) return 'violated'
  // If all people are assigned and count === 1, it's satisfied
  if (assignedCount === totalPeople && count === 1) return 'satisfied'
  return 'unknown'
}

function evalRoomPopulation(
  clue: Extract<Clue, { kind: 'room-population' }>,
  assignment: Assignment,
  puzzle: Puzzle,
  allPersonIds: string[],
): EvalResult {
  let countInRoom = 0
  for (const [, c] of assignment) {
    if (getRoomId(c, puzzle) === clue.roomId) countInRoom++
  }

  if (countInRoom > clue.count) return 'violated'

  const totalPeople = allPersonIds.length
  const assignedCount = assignment.size
  if (assignedCount === totalPeople) {
    return countInRoom === clue.count ? 'satisfied' : 'violated'
  }
  return 'unknown'
}

function evalObjectOccupancy(
  clue: Extract<Clue, { kind: 'object-occupancy' }>,
  assignment: Assignment,
  puzzle: Puzzle,
  allPersonIds: string[],
): EvalResult {
  const matchingObjects = puzzle.objects.filter(o => o.kind === clue.objectKind && o.occupiable === 'occupiable')
  let occupiedCount = 0
  for (const obj of matchingObjects) {
    const isOccupied = obj.cells.some(cell =>
      [...assignment.values()].some(c => c.row === cell.row && c.col === cell.col)
    )
    if (isOccupied) occupiedCount++
  }

  if (occupiedCount > clue.count) return 'violated'

  const totalPeople = allPersonIds.length
  if (assignment.size === totalPeople) {
    return occupiedCount === clue.count ? 'satisfied' : 'violated'
  }
  return 'unknown'
}

function evalPersonNotInRoom(
  clue: Extract<Clue, { kind: 'person-not-in-room' }>,
  assignment: Assignment,
  puzzle: Puzzle,
): EvalResult {
  const coord = assignment.get(clue.person)
  if (!coord) return 'unknown'
  return getRoomId(coord, puzzle) !== clue.roomId ? 'satisfied' : 'violated'
}

function evalPersonsNotSameRoom(
  clue: Extract<Clue, { kind: 'persons-not-same-room' }>,
  assignment: Assignment,
  puzzle: Puzzle,
): EvalResult {
  const a = assignment.get(clue.personA)
  const b = assignment.get(clue.personB)
  if (!a || !b) return 'unknown'
  const ra = getRoomId(a, puzzle)
  const rb = getRoomId(b, puzzle)
  if (!ra || !rb) return 'unknown'
  return ra !== rb ? 'satisfied' : 'violated'
}

// ─── Main Evaluator ───────────────────────────────────────────────────────────

export function evaluateClue(
  clue: Clue,
  assignment: Assignment,
  puzzle: Puzzle,
): EvalResult {
  const allPersonIds = puzzle.people.map(p => p.id)
  switch (clue.kind) {
    case 'person-direction': return evalPersonDirection(clue, assignment)
    case 'person-distance': return evalPersonDistance(clue, assignment)
    case 'person-beside-object': return evalPersonBesideObject(clue, assignment, puzzle)
    case 'person-on-object': return evalPersonOnObject(clue, assignment, puzzle)
    case 'person-in-room': return evalPersonInRoom(clue, assignment, puzzle)
    case 'persons-same-room': return evalPersonsSameRoom(clue, assignment, puzzle)
    case 'person-alone-in-room': return evalPersonAloneInRoom(clue, assignment, puzzle, allPersonIds)
    case 'room-population': return evalRoomPopulation(clue, assignment, puzzle, allPersonIds)
    case 'object-occupancy': return evalObjectOccupancy(clue, assignment, puzzle, allPersonIds)
    case 'person-not-in-room': return evalPersonNotInRoom(clue, assignment, puzzle)
    case 'persons-not-same-room': return evalPersonsNotSameRoom(clue, assignment, puzzle)
  }
}

export { getRoomId, getObjectsAtCoord, getObjectsAdjacentInRoom, directionFromAToB }
