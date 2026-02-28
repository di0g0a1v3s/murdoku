import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { Puzzle, PuzzleCollection } from '../shared/types.js'

const DEFAULT_PATH = 'src/puzzles/puzzles.json'

export function loadCollection(path = DEFAULT_PATH): PuzzleCollection {
  if (!existsSync(path)) {
    return { version: '1.0.0', puzzles: [] }
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as PuzzleCollection
}

export function saveCollection(collection: PuzzleCollection, path = DEFAULT_PATH): void {
  writeFileSync(path, JSON.stringify(collection, null, 2), 'utf-8')
}

export function appendPuzzle(puzzle: Puzzle, path = DEFAULT_PATH): void {
  const collection = loadCollection(path)
  // Replace if same id exists, otherwise append
  const existingIndex = collection.puzzles.findIndex(p => p.id === puzzle.id)
  if (existingIndex >= 0) {
    collection.puzzles[existingIndex] = puzzle
  } else {
    collection.puzzles.push(puzzle)
  }
  saveCollection(collection, path)
}
