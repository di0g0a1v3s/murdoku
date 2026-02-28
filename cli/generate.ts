import * as readline from 'readline'
import { randomInt } from 'crypto'
import type { Puzzle } from '../shared/types.js'
import { solve } from '../shared/solver.js'
import { generateTheme, generateClues, generateAdditionalClue } from './llm-client.js'
import { buildLayout, hasEnoughOccupiableCells } from './layout-builder.js'
import { placePeople } from './placer.js'
import { computeAllFacts } from './clue-generator.js'
import { appendPuzzle } from './output.js'
import { printCostSummary, resetCosts } from './cost-tracker.js'

const OUTPUT_PATH = 'src/puzzles/puzzles.json'
const GRID_ROWS = 6
const GRID_COLS = 6
const MAX_LAYOUT_RETRIES = 10
const MAX_PLACEMENT_RETRIES = 10
const MAX_CLUE_AUGMENT_RETRIES = 5

// ─── CLI helpers ──────────────────────────────────────────────────────────────

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function printPuzzleSummary(puzzle: Puzzle): void {
  console.log('\n' + '═'.repeat(60))
  console.log(`📍 ${puzzle.title}`)
  if (puzzle.subtitle) console.log(`   ${puzzle.subtitle}`)
  console.log('═'.repeat(60))

  console.log('\n📦 ROOMS:')
  for (const room of puzzle.rooms) {
    const count = puzzle.solution.placements.filter(p => {
      const cell = p.coord
      return room.cells.some(c => c.row === cell.row && c.col === cell.col)
    }).length
    console.log(`  ${room.name} (${room.cells.length} cells, ${count} people)`)
  }

  console.log('\n🪑 OBJECTS:')
  for (const obj of puzzle.objects) {
    const isOccupied = obj.cells.some(c =>
      puzzle.solution.placements.some(p => p.coord.row === c.row && p.coord.col === c.col)
    )
    console.log(`  ${obj.kind} (${obj.occupiable}) at [${obj.cells.map(c => `${c.row},${c.col}`).join(' | ')}]${isOccupied ? ' ← OCCUPIED' : ''}`)
  }

  console.log('\n👤 PLACEMENTS:')
  for (const p of puzzle.solution.placements) {
    const person = puzzle.people.find(pe => pe.id === p.personId)!
    const room = puzzle.rooms.find(r => r.cells.some(c => c.row === p.coord.row && c.col === p.coord.col))
    const marker = p.personId === puzzle.solution.victimId ? ' 💀 VICTIM' :
                   p.personId === puzzle.solution.murdererId ? ' 🔪 MURDERER' : ''
    console.log(`  ${person.avatarEmoji} ${person.name} → row ${p.coord.row}, col ${p.coord.col} (${room?.name})${marker}`)
  }

  console.log('\n🔍 CLUES:')
  puzzle.clues.forEach((clue, i) => {
    console.log(`  ${i + 1}. [${clue.kind}] ${clue.text}`)
  })

  console.log('\n🔴 SOLUTION: ' + puzzle.people.find(p => p.id === puzzle.solution.murdererId)?.name + ' committed the murder in ' + puzzle.solution.murderRoom)
  console.log('═'.repeat(60))
}

// ─── Grid rendering for terminal ──────────────────────────────────────────────

function printGrid(puzzle: Puzzle): void {
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill('   '))

  // Mark rooms
  for (const room of puzzle.rooms) {
    const initial = room.name[0].toUpperCase()
    for (const cell of room.cells) {
      grid[cell.row][cell.col] = ` ${initial} `
    }
  }

  // Mark objects
  for (const obj of puzzle.objects) {
    const sym = obj.occupiable === 'occupiable' ? obj.kind[0].toUpperCase() : obj.kind[0].toLowerCase()
    for (const cell of obj.cells) {
      grid[cell.row][cell.col] = `[${sym}]`
    }
  }

  // Mark people
  for (const p of puzzle.solution.placements) {
    const marker = p.personId === puzzle.solution.victimId ? '💀' :
                   p.personId === puzzle.solution.murdererId ? '🔪' : '👤'
    grid[p.coord.row][p.coord.col] = marker + ' '
  }

  console.log('\n📐 GRID (room initials, [O]ccupiable/[n]on-occ objects, people):')
  console.log('    ' + Array.from({ length: GRID_COLS }, (_, i) => ` ${i}  `).join(''))
  for (let r = 0; r < GRID_ROWS; r++) {
    console.log(`  ${r} ` + grid[r].map(cell => `${cell} `).join('|'))
  }
}

// ─── Main generation pipeline ─────────────────────────────────────────────────

async function generatePuzzle(): Promise<Puzzle> {
  console.log('\n🎲 Step 1: Generating theme via LLM...')
  const theme = await generateTheme()
  console.log(`✅ Theme: "${theme.title}"`)

  // Step 2: Build grid layout
  let layout = null
  let layoutSeed = randomInt(0, 1_000_000)
  for (let attempt = 0; attempt < MAX_LAYOUT_RETRIES; attempt++) {
    console.log(`\n🏗️  Step 2: Building layout (attempt ${attempt + 1})...`)
    const candidate = buildLayout(theme, layoutSeed + attempt)
    if (hasEnoughOccupiableCells(candidate.rooms, candidate.objects, 6)) {
      layout = candidate
      break
    }
    console.log('  ⚠️  Not enough occupiable cells, retrying...')
  }
  if (!layout) throw new Error('Failed to build valid layout after retries')
  console.log(`✅ Layout built: ${layout.rooms.length} rooms, ${layout.objects.length} objects`)

  // Step 3: Place people
  let placerResult = null
  let placementSeed = randomInt(0, 1_000_000)
  for (let attempt = 0; attempt < MAX_PLACEMENT_RETRIES; attempt++) {
    console.log(`\n👥 Step 3: Placing people (attempt ${attempt + 1})...`)
    const result = placePeople(theme.people, layout, GRID_ROWS, GRID_COLS, placementSeed + attempt * 100)
    if (result) {
      placerResult = result
      break
    }
    console.log('  ⚠️  No valid placement found, retrying...')
  }
  if (!placerResult) throw new Error('Failed to place people after retries')
  console.log(`✅ Placed ${theme.people.length} people. Murderer: ${theme.people.find(p => p.id === placerResult!.murdererId)?.name}`)

  // Build partial puzzle for fact computation
  const partialPuzzle: Puzzle = {
    id: '',
    title: theme.title,
    subtitle: theme.subtitle,
    gridSize: { rows: GRID_ROWS, cols: GRID_COLS },
    rooms: layout.rooms,
    objects: layout.objects,
    people: theme.people,
    clues: [],
    solution: {
      placements: placerResult.placements,
      murdererId: placerResult.murdererId,
      victimId: placerResult.victimId,
      murderRoom: placerResult.murderRoom,
    },
    generatedAt: new Date().toISOString(),
  }

  // Step 4: Compute derivable facts
  console.log('\n📊 Step 4: Computing derivable facts...')
  const facts = computeAllFacts(partialPuzzle, placerResult.placements)
  console.log(`✅ Found ${facts.length} derivable facts`)

  // Step 5: Generate clues via LLM
  console.log('\n✍️  Step 5: Generating clues via LLM...')
  let clues = await generateClues(theme, facts, 10)
  console.log(`✅ Generated ${clues.length} clues`)

  // Step 6: Verify uniqueness
  console.log('\n🔍 Step 6: Verifying unique solution...')
  partialPuzzle.clues = clues

  let verifyResult = solve(partialPuzzle, clues, 2)
  let augmentAttempts = 0

  while (verifyResult.status !== 'unique' && augmentAttempts < MAX_CLUE_AUGMENT_RETRIES) {
    if (verifyResult.status === 'none') {
      console.log('  ⚠️  No valid solution found — clues may be contradictory. Adding clarifying clue...')
    } else {
      console.log(`  ⚠️  Multiple solutions exist. Adding constraining clue (attempt ${augmentAttempts + 1})...`)
    }

    const extra = await generateAdditionalClue(theme, facts, clues)
    if (!extra) {
      console.log('  ❌ No more facts to add!')
      break
    }
    clues = [...clues, extra]
    partialPuzzle.clues = clues
    verifyResult = solve(partialPuzzle, clues, 2)
    augmentAttempts++
  }

  if (verifyResult.status !== 'unique') {
    throw new Error(`Could not achieve unique solution after ${augmentAttempts} augmentation attempts. Status: ${verifyResult.status}`)
  }
  console.log('✅ Unique solution verified!')

  // Step 7: Build final puzzle
  const id = theme.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) +
    '-' + Date.now().toString(36)

  return {
    ...partialPuzzle,
    id,
    clues,
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable is not set.')
    process.exit(1)
  }

  console.log('🕵️  Murdoku Puzzle Generator')
  console.log('━'.repeat(40))

  let keepGoing = true
  while (keepGoing) {
    resetCosts()
    try {
      const puzzle = await generatePuzzle()
      printGrid(puzzle)
      printPuzzleSummary(puzzle)
      printCostSummary()

      const answer = await ask('\n💾 Save this puzzle? [Y/n]: ')
      if (answer.toLowerCase() !== 'n') {
        appendPuzzle(puzzle, OUTPUT_PATH)
        console.log(`✅ Puzzle saved to ${OUTPUT_PATH}`)
      } else {
        console.log('⏭️  Puzzle discarded.')
      }

      const another = await ask('\n🎲 Generate another puzzle? [y/N]: ')
      keepGoing = another.toLowerCase() === 'y'
    } catch (err) {
      console.error('❌ Error generating puzzle:', err)
      printCostSummary()
      const retry = await ask('Try again? [y/N]: ')
      keepGoing = retry.toLowerCase() === 'y'
    }
  }

  console.log('\n👋 Done!')
}

main().catch(console.error)
