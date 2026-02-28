import { randomInt } from 'crypto'
import type { Clue, Puzzle } from '../shared/types.js'
import { solve } from '../shared/solver.js'
import { evaluateClue } from '../shared/clue-evaluator.js'
import { generateTheme, generateSuspectText, setDebug } from './llm-client.js'
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

// ─── CLI helpers ──────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
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
  const layoutSeed = randomInt(0, 1_000_000)
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
  const placementSeed = randomInt(0, 1_000_000)
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

  // Strip facts about the victim — victim has a fixed hardcoded clue in the UI
  const victimId = partialPuzzle.solution.victimId
  const nonVictimFacts = facts.filter(f => {
    const c = f.clue as Record<string, unknown>
    return c['person'] !== victimId && c['personA'] !== victimId
  })

  function getCluePersonId(clue: Clue): string | null {
    switch (clue.kind) {
      case 'person-direction':
      case 'person-distance':
      case 'persons-same-room':
      case 'persons-not-same-room':
        return clue.personA
      case 'person-beside-object':
      case 'person-on-object':
      case 'person-in-room':
      case 'person-alone-in-room':
      case 'person-not-in-room':
        return clue.person
      default:
        return null
    }
  }

  // Returns true if this suspect's clues alone (evaluated in isolation, no
  // Latin-square reasoning) leave exactly one compatible cell.
  function suspectIsPinned(suspectId: string, suspectClues: Clue[]): boolean {
    if (suspectClues.length === 0) return false
    const { rows, cols } = partialPuzzle.gridSize
    let compatibleCount = 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const nonOccupiable = partialPuzzle.objects.some(obj =>
          obj.occupiable === 'non-occupiable' &&
          obj.cells.some(c => c.row === row && c.col === col)
        )
        if (nonOccupiable) continue
        const assignment = new Map([[suspectId, { row, col }]])
        const ok = suspectClues.every(c => evaluateClue(c, assignment, partialPuzzle) !== 'violated')
        if (ok && ++compatibleCount > 1) return false
      }
    }
    return compatibleCount === 1
  }

  // Step 5: Start from every derivable fact, shuffle for variety.
  // (a) De-pin: while the pool is large, greedily remove any clue that pins a suspect
  //     (evaluated in isolation). No uniqueness check here — we have many facts to spare.
  // (b) Minimize: greedily remove redundant clues (uniqueness + coverage only).
  console.log('\n✂️  Step 5: Minimizing clue set...')
  let clues = shuffle(nonVictimFacts.map(f => ({ ...f.clue, text: f.description } as Clue)))
  console.log(`  Starting with ${clues.length} candidate clues`)
  auditClues('all facts', clues)

  const suspectIds = new Set(partialPuzzle.people.filter(p => p.role === 'suspect').map(p => p.id))

  // (a) De-pin pass — remove over-constraining clues while the pool is still large
  let pinChanged = true
  while (pinChanged) {
    pinChanged = false
    for (const suspect of partialPuzzle.people.filter(p => p.role === 'suspect')) {
      const suspectClues = clues.filter(c => getCluePersonId(c) === suspect.id)
      if (!suspectIsPinned(suspect.id, suspectClues)) continue
      for (let i = 0; i < clues.length; i++) {
        if (getCluePersonId(clues[i]!) !== suspect.id) continue
        const candidate = [...clues.slice(0, i), ...clues.slice(i + 1)]
        const covered = new Set(candidate.map(c => getCluePersonId(c)).filter(Boolean))
        if (!covered.has(suspect.id)) continue
        if (suspectIsPinned(suspect.id, candidate.filter(c => getCluePersonId(c) === suspect.id))) continue
        clues = candidate
        pinChanged = true
        break
      }
    }
  }
  console.log(`  ${clues.length} clues after de-pinning`)

  // (b) Minimize pass — remove any clue redundant for uniqueness or coverage
  partialPuzzle.clues = clues
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < clues.length; i++) {
      const candidate = [...clues.slice(0, i), ...clues.slice(i + 1)]
      const covered = new Set(candidate.map(c => getCluePersonId(c)).filter(Boolean))
      if ([...suspectIds].some(id => !covered.has(id))) continue
      if (solve(partialPuzzle, candidate, 2).status !== 'unique') continue
      console.log(`  ✂️  Removed: ${clues[i]!.text}`)
      clues = candidate
      partialPuzzle.clues = clues
      changed = true
      break
    }
  }
  console.log(`✅ Minimized to ${clues.length} clues`)

  // Step 6: Generate one-sentence summaries per suspect
  console.log('\n✍️  Step 6: Generating suspect summaries...')

  const suspectSummaries: { personId: string; text: string }[] = []
  for (const suspect of partialPuzzle.people.filter(p => p.role === 'suspect')) {
    const suspectClues = clues.filter(c => getCluePersonId(c) === suspect.id)
    if (suspectClues.length === 0) continue
    const text = await generateSuspectText(
      suspect.name,
      suspect.avatarEmoji ?? '',
      suspectClues.map(c => c.text),
    )
    suspectSummaries.push({ personId: suspect.id, text })
    console.log(`  ✅ ${suspect.avatarEmoji} ${suspect.name}: "${text}"`)
  }

  // Step 7: Build final puzzle
  const id = theme.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) +
    '-' + Date.now().toString(36)

  return {
    ...partialPuzzle,
    id,
    clues,
    suspectSummaries,
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable is not set.')
    process.exit(1)
  }

  if (process.argv.includes('--debug')) {
    setDebug(true)
    console.log('🐛 Debug mode enabled — LLM prompts and responses will be printed')
  }

  console.log('🕵️  Murdoku Puzzle Generator')
  console.log('━'.repeat(40))

  resetCosts()
  try {
    const puzzle = await generatePuzzle()
    printGrid(puzzle)
    printPuzzleSummary(puzzle)
    printCostSummary()

    appendPuzzle(puzzle, OUTPUT_PATH)
    console.log(`✅ Puzzle saved to ${OUTPUT_PATH}`)
  } catch (err) {
    console.error('❌ Error generating puzzle:', err)
    printCostSummary()
  }

  console.log('\n👋 Done!')
}

main().catch(console.error)
