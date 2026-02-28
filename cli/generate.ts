import * as readline from 'readline'
import { randomInt } from 'crypto'
import type { Clue, ObjectKind, Puzzle } from '../shared/types.js'
import { solve } from '../shared/solver.js'
import { evaluateClue } from '../shared/clue-evaluator.js'
import { generateTheme, generateClues, generateAdditionalClue } from './llm-client.js'
import { buildLayout, hasEnoughOccupiableCells } from './layout-builder.js'
import { placePeople } from './placer.js'
import { computeAllFacts } from './clue-generator.js'
import { appendPuzzle } from './output.js'
import { printCostSummary, resetCosts } from './cost-tracker.js'

const OUTPUT_PATH = 'src/puzzles/puzzles.json'
const MAX_CLUE_GEN_RETRIES = 3
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

  // Validate clues: filter out any whose IDs don't exist in the puzzle
  function validateClues(raw: Clue[]): Clue[] {
    const personIds = new Set(partialPuzzle.people.map(p => p.id))
    const roomIds = new Set(partialPuzzle.rooms.map(r => r.id))
    const objectKinds = new Set(partialPuzzle.objects.map(o => o.kind as ObjectKind))
    return raw.filter(clue => {
      switch (clue.kind) {
        case 'person-direction':
        case 'person-distance':
          return personIds.has(clue.personA) && personIds.has(clue.personB)
        case 'person-beside-object':
        case 'person-on-object':
          return personIds.has(clue.person) && objectKinds.has(clue.objectKind as ObjectKind)
        case 'person-in-room':
        case 'person-not-in-room':
          return personIds.has(clue.person) && roomIds.has(clue.roomId)
        case 'persons-same-room':
        case 'persons-not-same-room':
          return personIds.has(clue.personA) && personIds.has(clue.personB)
        case 'person-alone-in-room':
          return personIds.has(clue.person)
        case 'room-population':
          return roomIds.has(clue.roomId)
        case 'object-occupancy':
          return objectKinds.has(clue.objectKind as ObjectKind)
      }
    })
  }

  // Verify that every clue is actually satisfied by the known solution
  function auditClues(label: string, cluesToCheck: Clue[]): void {
    const knownAssignment = new Map(
      partialPuzzle.solution.placements.map(p => [p.personId, p.coord])
    )
    let anyViolated = false
    for (const clue of cluesToCheck) {
      const result = evaluateClue(clue, knownAssignment, partialPuzzle)
      if (result !== 'satisfied') {
        if (!anyViolated) console.log(`\n🔎 Clue audit [${label}]:`)
        anyViolated = true
        console.log(`  ❌ ${result.toUpperCase()}: [${clue.kind}] ${JSON.stringify(clue)}`)
      }
    }
    if (!anyViolated) console.log(`  ✅ All ${cluesToCheck.length} clues satisfy the known solution`)
  }

  // Step 5: Generate clues via LLM
  console.log('\n✍️  Step 5: Generating clues via LLM...')
  let clues = validateClues(await generateClues(theme, facts, 10))
  console.log(`✅ Validated ${clues.length} clues`)
  auditClues('initial', clues)

  // Step 6: Verify uniqueness
  // - status 'none'     → LLM produced contradictory clues; regenerate all clues
  // - status 'multiple' → clues are valid but under-constrained; add programmatic clues
  console.log('\n🔍 Step 6: Verifying unique solution...')
  partialPuzzle.clues = clues

  let verifyResult = solve(partialPuzzle, clues, 2)
  let clueGenRetries = 0
  let augmentAttempts = 0

  while (verifyResult.status !== 'unique') {
    if (verifyResult.status === 'none') {
      if (clueGenRetries >= MAX_CLUE_GEN_RETRIES) {
        throw new Error(`Clues remain contradictory after ${MAX_CLUE_GEN_RETRIES} regeneration attempts`)
      }
      console.log(`  ⚠️  No valid solution — LLM clues contradictory. Regenerating (attempt ${clueGenRetries + 2})...`)
      clueGenRetries++
      clues = validateClues(await generateClues(theme, facts, 10))
      console.log(`  ↳ Regenerated ${clues.length} valid clues`)
      auditClues(`retry ${clueGenRetries}`, clues)
    } else {
      // status === 'multiple'
      if (augmentAttempts >= MAX_CLUE_AUGMENT_RETRIES) {
        throw new Error(`Could not achieve unique solution after ${augmentAttempts} augmentation attempts`)
      }

      // Find unused facts (compare structural part only, ignoring LLM-generated text)
      const withoutText = (c: Record<string, unknown>) =>
        JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'text')))
      const usedKeys = new Set(clues.map(c => withoutText(c as Record<string, unknown>)))
      const unusedFacts = facts.filter(f => !usedKeys.has(withoutText(f.clue as Record<string, unknown>)))

      // Prefer facts that discriminate against the alternative solution
      const altPlacements = verifyResult.solutions[1]
      const altAssignment = altPlacements
        ? new Map(altPlacements.map(p => [p.personId, p.coord]))
        : null
      const candidateFacts = altAssignment
        ? unusedFacts.filter(f => evaluateClue(f.clue, altAssignment, partialPuzzle) === 'violated')
        : unusedFacts

      console.log(`  ⚠️  Multiple solutions exist. Adding constraining clue (attempt ${augmentAttempts + 1}) — ${candidateFacts.length} discriminating facts available...`)
      const extra = await generateAdditionalClue(candidateFacts.length > 0 ? candidateFacts : unusedFacts)
      if (!extra) {
        console.log('  ❌ No more facts to add!')
        break
      }
      clues = [...clues, extra]
      augmentAttempts++
    }
    partialPuzzle.clues = clues
    verifyResult = solve(partialPuzzle, clues, 2)
  }

  if (verifyResult.status !== 'unique') {
    throw new Error(`Could not achieve unique solution. Status: ${verifyResult.status}`)
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
