import { randomInt } from 'crypto';
import type { Clue, FullPuzzle, Puzzle } from '../shared/types.js';
import { getCluePersonId } from '../shared/types.js';
import { makeVictimClue, solve } from '../shared/solver.js';
import { evaluateClue } from '../shared/clue-evaluator.js';
import { generateTheme, generateAllTexts, setDebug } from './llm-client.js';
import { buildLayout, hasEnoughOccupiableCells } from './layout-builder.js';
import { placePeople } from './placer.js';
import { computeAllFacts } from './clue-generator.js';
import { appendPuzzle, loadCollection } from './output.js';
import { printCostSummary, resetCosts } from './cost-tracker.js';

const OUTPUT_PATH = 'src/puzzles/puzzles.json';
const MAX_LAYOUT_RETRIES = 10;

// ─── CLI helpers ──────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function printPuzzleSummary(puzzle: FullPuzzle): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`📍 ${puzzle.title}`);
  if (puzzle.subtitle) {
    console.log(`   ${puzzle.subtitle}`);
  }
  console.log('═'.repeat(60));

  console.log('\n📦 ROOMS:');
  for (const room of puzzle.rooms) {
    const count = puzzle.solution.placements.filter((p) => {
      const cell = p.coord;
      return room.cells.some((c) => c.row === cell.row && c.col === cell.col);
    }).length;
    console.log(`  ${room.name} (${room.cells.length} cells, ${count} people)`);
  }

  console.log('\n🪑 OBJECTS:');
  for (const obj of puzzle.objects) {
    const isOccupied = obj.cells.some((c) =>
      puzzle.solution.placements.some((p) => p.coord.row === c.row && p.coord.col === c.col),
    );
    console.log(
      `  ${obj.kind} (${obj.occupiable}) at [${obj.cells.map((c) => `${c.row},${c.col}`).join(' | ')}]${isOccupied ? ' ← OCCUPIED' : ''}`,
    );
  }

  console.log('\n👤 PLACEMENTS:');
  for (const p of puzzle.solution.placements) {
    const person = puzzle.people.find((pe) => pe.id === p.personId)!;
    const room = puzzle.rooms.find((r) =>
      r.cells.some((c) => c.row === p.coord.row && c.col === p.coord.col),
    );
    const marker =
      p.personId === puzzle.solution.victimId
        ? ' 💀 VICTIM'
        : p.personId === puzzle.solution.murdererId
          ? ' 🔪 MURDERER'
          : '';
    console.log(
      `  ${person.avatarEmoji} ${person.name} → row ${p.coord.row}, col ${p.coord.col} (${room?.name})${marker}`,
    );
  }

  console.log('\n🔍 CLUES:');
  puzzle.clues.forEach((clue, i) => {
    console.log(`  ${i + 1}. [${clue.kind}] ${clue.text}`);
  });

  console.log(
    '\n🔴 SOLUTION: ' +
      puzzle.people.find((p) => p.id === puzzle.solution.murdererId)?.name +
      ' committed the murder in ' +
      puzzle.solution.murderRoom,
  );
  console.log('═'.repeat(60));
}

// ─── Grid rendering for terminal ──────────────────────────────────────────────

function printGrid(puzzle: Puzzle): void {
  const { rows: GRID_ROWS, cols: GRID_COLS } = puzzle.gridSize;
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill('   '));

  // Mark rooms
  for (const room of puzzle.rooms) {
    const initial = room.name[0].toUpperCase();
    for (const cell of room.cells) {
      grid[cell.row][cell.col] = ` ${initial} `;
    }
  }

  // Mark objects
  for (const obj of puzzle.objects) {
    const sym =
      obj.occupiable === 'occupiable' ? obj.kind[0].toUpperCase() : obj.kind[0].toLowerCase();
    for (const cell of obj.cells) {
      grid[cell.row][cell.col] = `[${sym}]`;
    }
  }

  // Mark people
  for (const p of puzzle.solution.placements) {
    const marker =
      p.personId === puzzle.solution.victimId
        ? '💀'
        : p.personId === puzzle.solution.murdererId
          ? '🔪'
          : '👤';
    grid[p.coord.row][p.coord.col] = marker + ' ';
  }

  console.log('\n📐 GRID (room initials, [O]ccupiable/[n]on-occ objects, people):');
  console.log('    ' + Array.from({ length: GRID_COLS }, (_, i) => ` ${i}  `).join(''));
  for (let r = 0; r < GRID_ROWS; r++) {
    console.log(`  ${r} ` + grid[r].map((cell) => `${cell} `).join('|'));
  }
}

// ─── Main generation pipeline ─────────────────────────────────────────────────

async function generatePuzzle(
  existingTitles: string[],
  n: number,
  victimClueRequired: boolean,
  difficulty: FullPuzzle['difficulty'],
): Promise<FullPuzzle> {
  console.log('\n🎲 Step 1: Generating theme via LLM...');
  const theme = await generateTheme(n, existingTitles);
  console.log(`✅ Theme: "${theme.title}"`);

  // Step 2: Build grid layout
  let layout = null;
  const layoutSeed = randomInt(0, 1_000_000);
  for (let attempt = 0; attempt < MAX_LAYOUT_RETRIES; attempt++) {
    console.log(`\n🏗️  Step 2: Building layout (attempt ${attempt + 1})...`);
    try {
      const candidate = buildLayout(theme, layoutSeed + attempt, n, n);
      if (hasEnoughOccupiableCells(candidate.rooms, candidate.objects, n)) {
        layout = candidate;
        break;
      }
      console.log('  ⚠️  Not enough occupiable cells, retrying...');
    } catch (err) {
      console.log(`  ⚠️  ${err instanceof Error ? err.message : String(err)}, retrying...`);
    }
  }
  if (!layout) {
    throw new Error('Failed to build valid layout after retries');
  }
  console.log(`✅ Layout built: ${layout.rooms.length} rooms, ${layout.objects.length} objects`);

  // Step 3: Place people (exhaustive search — no retries needed)
  console.log(`\n👥 Step 3: Placing people...`);
  const placerResult = placePeople(theme.people, layout, n, n, randomInt(0, 1_000_000));
  if (!placerResult) {
    throw new Error('Failed to place people: no valid placement exists for this layout');
  }
  console.log(
    `✅ Placed ${theme.people.length} people. Murderer: ${theme.people.find((p) => p.id === placerResult!.murdererId)?.name}`,
  );

  // Build partial puzzle for fact computation
  const partialPuzzle: Puzzle = {
    gridSize: { rows: n, cols: n },
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
  };
  const puzzleMeta = {
    title: theme.title,
    subtitle: theme.subtitle,
    generatedAt: new Date().toISOString(),
  };

  // Step 4: Compute derivable facts
  console.log('\n📊 Step 4: Computing derivable facts...');
  const facts = computeAllFacts(partialPuzzle, placerResult.placements);
  console.log(`✅ Found ${facts.length} derivable facts`);

  // Verify that every clue is actually satisfied by the known solution
  function auditClues(label: string, cluesToCheck: Clue[]): void {
    const knownAssignment = new Map(
      partialPuzzle.solution.placements.map((p) => [p.personId, p.coord]),
    );
    let anyViolated = false;
    for (const clue of cluesToCheck) {
      const result = evaluateClue(clue, knownAssignment, partialPuzzle);
      if (result !== 'satisfied') {
        if (!anyViolated) {
          console.log(`\n🔎 Clue audit [${label}]:`);
        }
        anyViolated = true;
        console.log(`  ❌ ${result.toUpperCase()}: [${clue.kind}] ${JSON.stringify(clue)}`);
      }
    }
    if (!anyViolated) {
      console.log(`  ✅ All ${cluesToCheck.length} clues satisfy the known solution`);
    }
  }

  // Strip facts about the victim — victim has a fixed hardcoded clue in the UI
  const victimId = partialPuzzle.solution.victimId;
  const nonVictimFacts = facts.filter((f) => {
    const c = f.clue as Record<string, unknown>;
    return (
      c['person'] !== victimId &&
      c['personA'] !== victimId &&
      !(f.clue.kind === 'persons-same-room' && c['personB'] === victimId)
    );
  });

  // Pre-build the set of non-occupiable coords for fast lookup.
  const nonOccupiableSet = new Set(
    partialPuzzle.objects
      .filter((obj) => obj.occupiable === 'non-occupiable')
      .flatMap((obj) => obj.cells.map((c) => `${c.row},${c.col}`)),
  );
  const { rows, cols } = partialPuzzle.gridSize;
  const occupiableCells: { row: number; col: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!nonOccupiableSet.has(`${row},${col}`)) {
        occupiableCells.push({ row, col });
      }
    }
  }

  // Returns true if this suspect's clues alone (evaluated in isolation, no
  // Latin-square reasoning) leave exactly one compatible cell.
  function suspectIsPinned(suspectId: string, suspectClues: Clue[]): boolean {
    if (suspectClues.length === 0) {
      return false;
    }
    let compatibleCount = 0;
    for (const cell of occupiableCells) {
      const assignment = new Map([[suspectId, cell]]);
      const ok = suspectClues.every(
        (c) => evaluateClue(c, assignment, partialPuzzle) !== 'violated',
      );
      if (ok) {
        compatibleCount++;
        if (compatibleCount > 1) {
          return false;
        }
      }
    }
    return compatibleCount === 1;
  }

  // Step 5: Start from every derivable fact, shuffle for variety.
  // (a) De-pin: while the pool is large, greedily remove any clue that pins a suspect
  //     (evaluated in isolation). No uniqueness check here — we have many facts to spare.
  // (b) Minimize: greedily remove redundant clues (uniqueness + coverage only).
  console.log('\n✂️  Step 5: Minimizing clue set...');
  // Lower weight = sorted to front = tried for removal first = less likely to survive.
  const CLUE_WEIGHT: Record<Clue['kind'], number> = {
    'person-direction': 1,
    'person-distance': 1,
    'person-in-row': 2,
    'person-in-col': 2,
    'person-in-corner': 3,
    'person-in-room-corner': 3,
    'person-beside-object': 4,
    'person-on-object': 4,
    'person-not-in-room': 4,
    'persons-not-same-room': 4,
    'person-in-room': 5,
    'persons-same-room': 5,
    'person-alone-in-room': 5,
    'person-in-room-with': 5,
    'person-sole-occupant': 5,
    'room-population': 5,
    'object-occupancy': 5,
    'empty-rooms': 5,
  };

  let clues = shuffle(nonVictimFacts.map((f) => ({ ...f.clue, text: f.description }) as Clue)).sort(
    (a, b) => CLUE_WEIGHT[a.kind] - CLUE_WEIGHT[b.kind],
  );
  console.log(`  Starting with ${clues.length} candidate clues`);
  auditClues('all facts', clues);

  const suspectIds = new Set(
    partialPuzzle.people.filter((p) => p.role === 'suspect').map((p) => p.id),
  );

  // (a) De-pin pass — remove over-constraining clues while the pool is still large
  let pinChanged = true;
  while (pinChanged) {
    pinChanged = false;
    for (const suspect of partialPuzzle.people.filter((p) => p.role === 'suspect')) {
      const suspectClues = clues.filter((c) => getCluePersonId(c) === suspect.id);
      if (!suspectIsPinned(suspect.id, suspectClues)) {
        continue;
      }
      for (let i = 0; i < clues.length; i++) {
        if (getCluePersonId(clues[i]!) !== suspect.id) {
          continue;
        }
        const candidate = [...clues.slice(0, i), ...clues.slice(i + 1)];
        if (
          suspectIsPinned(
            suspect.id,
            candidate.filter((c) => getCluePersonId(c) === suspect.id),
          )
        ) {
          continue;
        }
        console.log(`  ✂️  De-pinned [${suspect.name}]: ${clues[i]!.kind}`);
        clues = candidate;
        pinChanged = true;
        break;
      }
    }
  }
  console.log(`  ${clues.length} clues after de-pinning`);

  for (const suspect of partialPuzzle.people.filter((p) => p.role === 'suspect')) {
    if (!clues.some((c) => getCluePersonId(c) === suspect.id)) {
      throw new Error(`De-pin left suspect ${suspect.name} with no clues — puzzle is degenerate`);
    }
  }

  // Minimize: sweep through, removing any redundant clue (O(clues × passes)).
  const victimClue = makeVictimClue(partialPuzzle);
  partialPuzzle.clues = clues;
  let passChanged = true;
  while (passChanged) {
    passChanged = false;
    let i = 0;
    while (i < clues.length) {
      const candidate = [...clues.slice(0, i), ...clues.slice(i + 1)];
      const covered = new Set(candidate.map((c) => getCluePersonId(c)).filter(Boolean));
      if ([...suspectIds].some((id) => !covered.has(id))) {
        console.log(`  📌 Kept (last clue for suspect): ${clues[i]!.text}`);
        i++;
        continue;
      }
      const solveClues = victimClueRequired ? [...candidate, victimClue] : candidate;
      if (solve(partialPuzzle, solveClues).status !== 'unique') {
        console.log(`  📌 Kept (needed for uniqueness): ${clues[i]!.text}`);
        i++;
        continue;
      }
      console.log(
        `  ✂️  Removed: ${clues[i]!.text}, current: ${candidate.length}/${nonVictimFacts.length}`,
      );
      clues = candidate;
      partialPuzzle.clues = clues;
      passChanged = true;
      // Don't increment i — the array shifted left, next clue is now at position i
    }
  }
  console.log(`✅ Minimized to ${clues.length} clues`);

  // Step 6: Generate all clue texts in one LLM call
  console.log('\n✍️  Step 6: Generating clue texts...');

  const suspectInputs = partialPuzzle.people
    .filter((p) => p.role === 'suspect')
    .map((p) => ({
      personId: p.id,
      name: p.name,
      factDescriptions: clues.filter((c) => getCluePersonId(c) === p.id).map((c) => c.text),
    }))
    .filter((s) => s.factDescriptions.length > 0);

  const generalClueInputs = clues
    .filter((c) => getCluePersonId(c) === null)
    .map((c) => ({ kind: c.kind, description: c.text }));

  const { suspectTexts, generalClueTexts } = await generateAllTexts(
    suspectInputs,
    generalClueInputs,
  );

  const suspectSummaries = suspectTexts.map(({ personId, text }) => {
    const suspect = partialPuzzle.people.find((p) => p.id === personId)!;
    console.log(`  ✅ ${suspect.avatarEmoji} ${suspect.name}: "${text}"`);
    return { personId, text };
  });

  // Update clue.text for general clues with naturalized text
  const generalClues = clues.filter((c) => getCluePersonId(c) === null);
  for (let i = 0; i < generalClues.length; i++) {
    const naturalText = generalClueTexts[i];
    if (!naturalText) {
      continue;
    }
    const idx = clues.indexOf(generalClues[i]!);
    if (idx !== -1) {
      clues[idx] = { ...clues[idx]!, text: naturalText };
    }
    console.log(`  ✅ [${generalClues[i]!.kind}] "${naturalText}"`);
  }

  // Step 7: Build final puzzle
  const id =
    theme.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40) +
    '-' +
    Date.now().toString(36);

  return {
    ...partialPuzzle,
    ...puzzleMeta,
    id,
    difficulty,
    clues,
    suspectSummaries,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  if (process.argv.includes('--debug')) {
    setDebug(true);
    console.log('🐛 Debug mode enabled — LLM prompts and responses will be printed');
  }

  const countArg = process.argv.find((a) => a.startsWith('--count='));
  const count = countArg ? parseInt(countArg.split('=')[1]!, 10) : 1;
  if (isNaN(count) || count < 1) {
    console.error('❌ --count must be a positive integer');
    process.exit(1);
  }

  const VALID_DIFFICULTIES = ['easy', 'easy+', 'medium', 'medium+', 'hard', 'hard+'] as const;
  const difficultyArg = process.argv.find((a) => a.startsWith('--difficulty='));
  const difficulty = (difficultyArg?.split('=')[1] ??
    'easy') as (typeof VALID_DIFFICULTIES)[number];
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    console.error(`❌ --difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}`);
    process.exit(1);
  }
  const DIFFICULTY_PEOPLE: Record<string, number> = {
    easy: 6,
    'easy+': 6,
    medium: 9,
    'medium+': 9,
    hard: 12,
    'hard+': 12,
  };
  const n = DIFFICULTY_PEOPLE[difficulty]!;
  const victimClueRequired = difficulty.endsWith('+');

  console.log('🕵️  Murdoku Puzzle Generator');
  console.log('━'.repeat(40));

  resetCosts();
  const usedTitles = loadCollection(OUTPUT_PATH).puzzles.map((p) => p.title);
  let succeeded = 0;
  for (let i = 0; i < count; i++) {
    if (count > 1) {
      console.log(`\n📦 Puzzle ${i + 1} of ${count}`);
    }
    try {
      const puzzle = await generatePuzzle(usedTitles, n, victimClueRequired, difficulty);
      usedTitles.push(puzzle.title);
      printGrid(puzzle);
      printPuzzleSummary(puzzle);
      appendPuzzle(puzzle, OUTPUT_PATH);
      console.log(`✅ Puzzle saved to ${OUTPUT_PATH}`);
      succeeded++;
    } catch (err) {
      console.error(`❌ Error generating puzzle ${i + 1}:`, err);
    }
  }

  printCostSummary();
  if (count > 1) {
    console.log(`\n📊 Generated ${succeeded}/${count} puzzles successfully`);
  }
  console.log('\n👋 Done!');
}

main().catch(console.error);
