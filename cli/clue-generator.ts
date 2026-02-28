import type { Direction, ObjectKind, PlacedPerson, Puzzle, Room } from '../shared/types.js'
import { getObjectsAdjacentInRoom, getObjectsAtCoord, directionFromAToB } from '../shared/clue-evaluator.js'
import type { DerivableFact } from './llm-client.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pairs<T>(arr: T[]): [T, T][] {
  const result: [T, T][] = []
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++)
      result.push([arr[i]!, arr[j]!])
  return result
}

function getRoomForPerson(personId: string, placements: PlacedPerson[], puzzle: Puzzle): Room | undefined {
  const placement = placements.find(p => p.personId === personId)
  if (!placement) return undefined
  return puzzle.rooms.find(r =>
    r.cells.some(c => c.row === placement.coord.row && c.col === placement.coord.col)
  )
}

const VALID_DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])
const CARDINAL_DIRECTIONS = new Set(['N', 'S', 'E', 'W'])

// ─── Derivable facts computation ──────────────────────────────────────────────

export function computeAllFacts(puzzle: Puzzle, placements: PlacedPerson[]): DerivableFact[] {
  const facts: DerivableFact[] = []
  const personName = (id: string) => puzzle.people.find(p => p.id === id)?.name ?? id

  // Per-person facts
  for (const placement of placements) {
    const { personId, coord } = placement
    const name = personName(personId)
    const room = puzzle.rooms.find(r =>
      r.cells.some(c => c.row === coord.row && c.col === coord.col)
    )
    if (!room) continue

    // Room membership
    facts.push({
      description: `${name} is in the ${room.name}`,
      clue: { kind: 'person-in-room', person: personId, roomId: room.id, text: '' },
    })

    // Object at cell (occupied)
    const objectsOnCell = getObjectsAtCoord(coord, puzzle)
    for (const obj of objectsOnCell) {
      if (obj.occupiable === 'occupiable') {
        facts.push({
          description: `${name} is on/at a ${obj.kind} in the ${room.name}`,
          clue: { kind: 'person-on-object', person: personId, objectKind: obj.kind as ObjectKind, text: '' },
        })
      }
    }

    // Adjacent objects (same room)
    const adjacentObjs = getObjectsAdjacentInRoom(coord, puzzle)
    const seenKinds = new Set<string>()
    for (const obj of adjacentObjs) {
      if (!seenKinds.has(obj.kind)) {
        seenKinds.add(obj.kind)
        facts.push({
          description: `${name} is beside a ${obj.kind} in the ${room.name}`,
          clue: { kind: 'person-beside-object', person: personId, objectKind: obj.kind as ObjectKind, text: '' },
        })
      }
    }
  }

  // Pairwise facts
  for (const [pA, pB] of pairs(placements)) {
    const nameA = personName(pA.personId)
    const nameB = personName(pB.personId)
    const cA = pA.coord
    const cB = pB.coord

    // Directional (general)
    // "A is [dir] of B" requires the direction of A as seen from B, i.e. directionFromAToB(cB, cA)
    const dirArelB = directionFromAToB(cB, cA) // where A is, relative to B
    if (dirArelB && VALID_DIRECTIONS.has(dirArelB)) {
      facts.push({
        description: `${nameA} is ${dirArelB} of ${nameB}`,
        clue: { kind: 'person-direction', personA: pA.personId, direction: dirArelB as Direction, personB: pB.personId, text: '' },
      })
    }
    const dirBrelA = directionFromAToB(cA, cB) // where B is, relative to A
    if (dirBrelA && VALID_DIRECTIONS.has(dirBrelA)) {
      facts.push({
        description: `${nameB} is ${dirBrelA} of ${nameA}`,
        clue: { kind: 'person-direction', personA: pB.personId, direction: dirBrelA as Direction, personB: pA.personId, text: '' },
      })
    }

    // Exact column distance (same row)
    if (cA.row === cB.row) {
      const colDiff = cA.col - cB.col
      const dir: Direction = colDiff > 0 ? 'E' : 'W'
      if (CARDINAL_DIRECTIONS.has(dir)) {
        facts.push({
          description: `${nameA} is exactly ${Math.abs(colDiff)} column(s) ${dir === 'E' ? 'east' : 'west'} of ${nameB}`,
          clue: { kind: 'person-distance', personA: pA.personId, direction: dir, personB: pB.personId, distance: Math.abs(colDiff), axis: 'col', text: '' },
        })
      }
    }

    // Exact row distance (same column)
    if (cA.col === cB.col) {
      const rowDiff = cA.row - cB.row
      const dir: Direction = rowDiff > 0 ? 'S' : 'N'
      facts.push({
        description: `${nameA} is exactly ${Math.abs(rowDiff)} row(s) ${dir === 'S' ? 'south' : 'north'} of ${nameB}`,
        clue: { kind: 'person-distance', personA: pA.personId, direction: dir, personB: pB.personId, distance: Math.abs(rowDiff), axis: 'row', text: '' },
      })
    }

    // Same room / not same room
    const roomA = getRoomForPerson(pA.personId, placements, puzzle)
    const roomB = getRoomForPerson(pB.personId, placements, puzzle)

    if (roomA && roomB) {
      if (roomA.id === roomB.id) {
        facts.push({
          description: `${nameA} and ${nameB} are in the same room (${roomA.name})`,
          clue: { kind: 'persons-same-room', personA: pA.personId, personB: pB.personId, text: '' },
        })
      } else {
        facts.push({
          description: `${nameA} and ${nameB} are NOT in the same room`,
          clue: { kind: 'persons-not-same-room', personA: pA.personId, personB: pB.personId, text: '' },
        })
        facts.push({
          description: `${nameA} is NOT in the ${roomB.name}`,
          clue: { kind: 'person-not-in-room', person: pA.personId, roomId: roomB.id, text: '' },
        })
        facts.push({
          description: `${nameB} is NOT in the ${roomA.name}`,
          clue: { kind: 'person-not-in-room', person: pB.personId, roomId: roomA.id, text: '' },
        })
      }
    }
  }

  // Room population facts
  for (const room of puzzle.rooms) {
    const count = placements.filter(p => {
      const r = puzzle.rooms.find(r => r.cells.some(c => c.row === p.coord.row && c.col === p.coord.col))
      return r?.id === room.id
    }).length
    if (count > 0) {
      facts.push({
        description: `The ${room.name} has exactly ${count} person(s)`,
        clue: { kind: 'room-population', roomId: room.id, count, text: '' },
      })
      if (count === 1) {
        const personHere = placements.find(p => {
          const r = puzzle.rooms.find(r => r.cells.some(c => c.row === p.coord.row && c.col === p.coord.col))
          return r?.id === room.id
        })
        if (personHere) {
          facts.push({
            description: `${personName(personHere.personId)} is alone in the ${room.name}`,
            clue: { kind: 'person-alone-in-room', person: personHere.personId, text: '' },
          })
        }
      }
    }
  }

  // Object occupancy facts
  const kindGroups = new Map<string, { total: number; occupied: number }>()
  for (const obj of puzzle.objects) {
    if (!kindGroups.has(obj.kind)) kindGroups.set(obj.kind, { total: 0, occupied: 0 })
    const group = kindGroups.get(obj.kind)!
    group.total++
    if (obj.occupiable === 'occupiable') {
      const isOccupied = obj.cells.some(c =>
        placements.some(p => p.coord.row === c.row && p.coord.col === c.col)
      )
      if (isOccupied) group.occupied++
    }
  }
  for (const [kind, { occupied }] of kindGroups) {
    if (occupied > 0) {
      facts.push({
        description: `Exactly ${occupied} ${kind}(s) are occupied`,
        clue: { kind: 'object-occupancy', objectKind: kind as ObjectKind, count: occupied, text: '' },
      })
    }
  }

  // Deduplicate by clue JSON
  const seen = new Set<string>()
  return facts.filter(f => {
    const key = JSON.stringify(f.clue)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
