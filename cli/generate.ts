import { randomInt } from 'crypto';
import type { Clue, FullPuzzle, Puzzle, StoredClue } from '../shared/types.js';
import { getCluePersonId } from '../shared/types.js';
import { makeVictimClue, solve } from '../shared/solver.js';
import { evaluateClue } from '../shared/clue-evaluator.js';
import { generateTheme, generateAllTexts, setDebug } from './llm-client.js';
import type { PuzzleTheme } from './llm-client.js';
import { buildLayout, hasEnoughOccupiableCells } from './layout-builder.js';
import { placePeople } from './placer.js';
import { computeAllFacts } from './clue-generator.js';
import { appendPuzzle, loadCollection } from './output.js';
import { printCostSummary, resetCosts } from './cost-tracker.js';
import { coordToKey } from '../shared/helpers.js';

const OUTPUT_PATH = 'src/puzzles/puzzles.json';
const MAX_LAYOUT_RETRIES = 100;
const MAX_BACKTRACKS = 50;

let debug = false;
const dlog = (...args: Parameters<typeof console.log>) => {
  if (debug) {
    console.log(...args);
  }
};

// ─── CLI helpers ──────────────────────────────────────────────────────────────

type WeightedItem<T> = {
  value: T;
  weight: number;
};

// Efraimidis–Spirakis weighted random permutation algorithm
function weightedShuffle<T>(items: WeightedItem<T>[]): T[] {
  return items
    .map((item) => {
      const u = Math.random();
      const key = -Math.log(u) / item.weight;
      return { item, key };
    })
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item.value);
}

function printPuzzleSummary(puzzle: FullPuzzle, theme: PuzzleTheme): void {
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
    const totalCells = puzzle.gridSize.rows * puzzle.gridSize.cols;
    const themeRoom = theme.rooms.find((r) => r.id === room.id);
    const llmPct = themeRoom
      ? (
          (themeRoom.sizePercentage / theme.rooms.reduce((s, r) => s + r.sizePercentage, 0)) *
          100
        ).toFixed(1)
      : '?';
    const actualPct = ((room.cells.length / totalCells) * 100).toFixed(1);
    console.log(
      `  ${room.name} (${room.cells.length} cells, ${count} people) — LLM: ${llmPct}%, actual: ${actualPct}%`,
    );
  }

  console.log('\n🪑 OBJECTS:');
  for (const obj of puzzle.objects) {
    const isOccupied = obj.cells.some((c) =>
      puzzle.solution.placements.some((p) => p.coord.row === c.row && p.coord.col === c.col),
    );
    console.log(
      `  ${obj.kind} (${obj.occupiable}) at [${obj.cells.map(coordToKey).join(' | ')}]${isOccupied ? ' ← OCCUPIED' : ''}`,
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
): Promise<{ puzzle: FullPuzzle; theme: PuzzleTheme }> {
  dlog('\n🎲 Step 1: Generating theme via LLM...');
  const theme = await generateTheme(n, existingTitles);
  dlog(`✅ Theme: "${theme.title}"`);

  let puzzle: Puzzle;
  let clues: StoredClue[];
  let backtrackingScore: number;
  let tries = 0;
  const MAX_RETRIES = 20;
  while (true) {
    try {
      tries++;
      const generatePuzzleRes = generatePuzzleFromTheme(theme, n, victimClueRequired);
      puzzle = generatePuzzleRes.puzzle;
      clues = generatePuzzleRes.clues;
      backtrackingScore = generatePuzzleRes.backtrackingScore;
      break;
    } catch (e) {
      if (tries >= MAX_RETRIES) {
        throw new Error(`Failed to create puzzle for ${theme.title} after ${MAX_RETRIES} tries`);
      }
      if (e instanceof Error) {
        console.error('Failed to generate puzzle. Retrying...', e.message);
      }
    }
  }

  const puzzleMeta = {
    title: theme.title,
    subtitle: theme.subtitle,
    generatedAt: new Date().toISOString(),
  };
  // Step 6: Generate all clue texts in one LLM call
  dlog('\n✍️  Step 6: Generating clue texts...');

  const suspectInputs = puzzle.people
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
    const suspect = puzzle.people.find((p) => p.id === personId)!;
    dlog(`  ✅ ${suspect.avatarEmoji} ${suspect.name}: "${text}"`);
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
    dlog(`  ✅ [${generalClues[i]!.kind}] "${naturalText}"`);
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
    puzzle: {
      ...puzzle,
      ...puzzleMeta,
      id,
      difficulty,
      clues,
      suspectSummaries,
      backtrackingScore,
    },
    theme,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  // TODO: generate random difficulties by default
  if (process.argv.includes('--debug')) {
    debug = true;
    setDebug(true);
    console.log('🐛 Debug mode enabled — LLM prompts and responses will be printed');
  }

  const countArg = process.argv.find((a) => a.startsWith('--count='));
  const count = countArg ? parseInt(countArg.split('=')[1]!, 10) : 1;
  if (isNaN(count) || count < 1) {
    console.error('❌ --count must be a positive integer');
    process.exit(1);
  }

  const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'very-hard'] as const;
  const difficultyArg = process.argv.find((a) => a.startsWith('--difficulty='));
  function randomDifficulty(): (typeof VALID_DIFFICULTIES)[number] {
    const r = Math.random();
    if (r < 0.2) {
      return 'easy';
    }
    if (r < 0.65) {
      return 'medium';
    }
    if (r < 0.95) {
      return 'hard';
    }
    return 'very-hard';
  }
  const fixedDifficulty = difficultyArg?.split('=')[1] as
    | (typeof VALID_DIFFICULTIES)[number]
    | undefined;
  if (fixedDifficulty !== undefined && !VALID_DIFFICULTIES.includes(fixedDifficulty)) {
    console.error(`❌ --difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}`);
    process.exit(1);
  }
  const DIFFICULTY_PEOPLE: Record<string, number> = {
    easy: 5,
    medium: 6,
    hard: 9,
    'very-hard': 12,
  };

  console.log('🕵️  Murdoku Puzzle Generator');
  console.log('━'.repeat(40));

  resetCosts();
  const usedTitles = loadCollection(OUTPUT_PATH).puzzles.map((p) => p.title);
  let succeeded = 0;
  for (let i = 0; i < count; i++) {
    const difficulty = fixedDifficulty ?? randomDifficulty();
    if (count > 1) {
      console.log(`\n📦 Puzzle ${i + 1} of ${count} [${difficulty}]`);
    } else {
      console.log(`\n📦 Difficulty: ${difficulty}`);
    }
    const n = DIFFICULTY_PEOPLE[difficulty]!;
    const victimClueRequired = difficulty !== 'easy';
    try {
      const { puzzle, theme } = await generatePuzzle(usedTitles, n, victimClueRequired, difficulty);
      usedTitles.push(puzzle.title);
      if (debug) {
        printGrid(puzzle);
        printPuzzleSummary(puzzle, theme);
      }
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

function generatePuzzleFromTheme(
  theme: PuzzleTheme,
  n: number,
  victimClueRequired: boolean,
): { puzzle: Puzzle; clues: StoredClue[]; backtrackingScore: number } {
  // Step 2: Build grid layout
  dlog(`\n🏗️  Step 2: Building layout...`);
  let layout = null;
  const layoutSeed = randomInt(0, 1_000_000);
  for (let attempt = 0; attempt < MAX_LAYOUT_RETRIES; attempt++) {
    try {
      const candidate = buildLayout(theme, layoutSeed + attempt, n, n);
      if (hasEnoughOccupiableCells(candidate.rooms, candidate.objects, n)) {
        layout = candidate;
        break;
      }
    } catch {
      // NOOP - retry
    }
  }
  if (!layout) {
    throw new Error(`Failed to build valid layout after ${MAX_LAYOUT_RETRIES} retries`);
  }
  dlog(`✅ Layout built: ${layout.rooms.length} rooms, ${layout.objects.length} objects`);

  // Step 3: Place people (exhaustive search — no retries needed)
  dlog(`\n👥 Step 3: Placing people...`);
  const placerResult = placePeople(theme.people, layout, n, n, randomInt(0, 1_000_000));
  if (!placerResult) {
    throw new Error('Failed to place people: no valid placement exists for this layout');
  }
  dlog(
    `✅ Placed ${theme.people.length} people. Murderer: ${theme.people.find((p) => p.id === placerResult!.murdererId)?.name}`,
  );

  // Build partial puzzle for fact computation
  const puzzle: Puzzle = {
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

  // Step 4: Compute derivable facts
  dlog('\n📊 Step 4: Computing derivable facts...');
  const facts = computeAllFacts(puzzle, placerResult.placements);
  dlog(`✅ Found ${facts.length} derivable facts`);

  // Verify that every clue is actually satisfied by the known solution
  function auditClues(label: string, cluesToCheck: Clue[]): void {
    const knownAssignment = new Map(puzzle.solution.placements.map((p) => [p.personId, p.coord]));
    let anyViolated = false;
    for (const clue of cluesToCheck) {
      const result = evaluateClue(clue, knownAssignment, puzzle);
      if (result !== 'satisfied') {
        if (!anyViolated) {
          dlog(`\n🔎 Clue audit [${label}]:`);
        }
        dlog(`  ❌ ${result.toUpperCase()}: [${clue.kind}] ${JSON.stringify(clue)}`);
        anyViolated = true;
      }
    }
    if (anyViolated) {
      throw new Error('Not all facts are satisfied');
    }
    dlog(`  ✅ All ${cluesToCheck.length} clues satisfy the known solution`);
  }

  // Strip facts about the victim — victim has a fixed hardcoded clue in the UI
  const victimId = puzzle.solution.victimId;
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
    puzzle.objects
      .filter((obj) => obj.occupiable === 'non-occupiable')
      .flatMap((obj) => obj.cells.map(coordToKey)),
  );
  const { rows, cols } = puzzle.gridSize;
  const occupiableCells: { row: number; col: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!nonOccupiableSet.has(coordToKey({ row, col }))) {
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
      const ok = suspectClues.every((c) => evaluateClue(c, assignment, puzzle) !== 'violated');
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
  dlog('\n✂️  Step 5: Minimizing clue set...');

  let clues: StoredClue[] = nonVictimFacts.map((f) => ({ ...f.clue, text: f.description }));
  const clueCountsPerType = new Map<string, number>();
  for (const clue of clues) {
    clueCountsPerType.set(clue.kind, (clueCountsPerType.get(clue.kind) ?? 0) + 1);
  }
  // Lower weight = sorted to front = tried for removal first = less likely to survive.
  clues = weightedShuffle(clues.map((u) => ({ value: u, weight: clueCountsPerType.get(u.kind)! })));

  // Cap the combined total of person-in-row and person-in-col to at most 3 (keep the last ones after shuffling).
  {
    const indices = clues
      .map((c, i) => (c.kind === 'person-in-row' || c.kind === 'person-in-col' ? i : -1))
      .filter((i) => i !== -1);
    if (indices.length > 3) {
      const toRemove = new Set(indices.slice(0, indices.length - 3));
      clues = clues.filter((_, i) => !toRemove.has(i));
    }
  }

  dlog(`  Starting with ${clues.length} candidate clues`);
  auditClues('all facts', clues);

  const suspectIds = new Set(puzzle.people.filter((p) => p.role === 'suspect').map((p) => p.id));

  // Minimize: sweep through, removing any redundant clue (O(clues × passes)).
  const victimClue = makeVictimClue(puzzle);
  puzzle.clues = clues;
  let passChanged = true;
  while (passChanged) {
    passChanged = false;
    let i = 0;
    while (i < clues.length) {
      const candidate = [...clues.slice(0, i), ...clues.slice(i + 1)];
      const covered = new Set(candidate.map((c) => getCluePersonId(c)).filter(Boolean));
      if ([...suspectIds].some((id) => !covered.has(id))) {
        dlog(`  📌 Kept (last clue for suspect): ${clues[i]!.text}`);
        i++;
        continue;
      }
      const solveClues = victimClueRequired ? [...candidate, victimClue] : candidate;
      const solverResult = solve(puzzle, solveClues, MAX_BACKTRACKS);
      if (solverResult.status === 'none') {
        dlog(`  📌 Kept (needed for solvability): ${clues[i]!.text}`);
        i++;
        continue;
      }
      if (solverResult.status === 'multiple' || solverResult.status === 'exceeded') {
        dlog(`  📌 Kept (needed for uniqueness): ${clues[i]!.text}`);
        i++;
        continue;
      }
      dlog(
        `  ✂️  Removed: ${clues[i]!.text}, current: ${candidate.length}/${nonVictimFacts.length}`,
      );
      clues = candidate;
      puzzle.clues = clues;
      passChanged = true;
      // Don't increment i — the array shifted left, next clue is now at position i
    }
  }
  dlog(`✅ Minimized to ${clues.length} clues`);

  for (const suspect of puzzle.people.filter((p) => p.role === 'suspect')) {
    if (
      suspectIsPinned(
        suspect.id,
        clues.filter((c) => getCluePersonId(c) === suspect.id),
      )
    ) {
      throw new Error(`Suspect ${suspect.name} is pinned after minimization — discarding puzzle`);
    }
    if (!clues.some((c) => getCluePersonId(c) === suspect.id)) {
      throw new Error(`De-pin left suspect ${suspect.name} with no clues — puzzle is degenerate`);
    }
  }

  const solveClues = [...clues, victimClue];
  const solveResult = solve(puzzle, solveClues, MAX_BACKTRACKS);
  if (solveResult.status === 'exceeded') {
    throw new Error(`Puzzle exceeds ${MAX_BACKTRACKS} backtracks — discarding`);
  }
  if (solveResult.status !== 'unique') {
    throw new Error('Generated puzzle is not unique');
  }
  console.log(
    `✅ Found puzzle with unique solution and no pins. Clues: ${clues.length}, backtracks: ${solveResult.metrics.backtracks}`,
  );
  return { puzzle, clues, backtrackingScore: solveResult.metrics.backtracks };
}

main().catch(console.error);
