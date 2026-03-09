# Murdoku — Project Context for Claude

## What is Murdoku

A logic puzzle game combining murder mystery storytelling with Sudoku-style grid constraints. Players deduce the positions of all suspects on a grid to identify the murderer.

**Live site:** https://di0g0a1v3s.github.io/murdoku/
**Repo:** https://github.com/di0g0a1v3s/murdoku

---

## Game Rules

**Grid:**
- N×N grid (size determined by difficulty — easy: 5×5, medium: 6×6, hard: 9×9, very-hard: 12×12), divided into named rooms
- Cells can be: empty, occupiable object (chair, bed, sofa, car, rug…), or non-occupiable object (table, plant, bookshelf, tv…)
- Objects can span multiple cells

**People:**
- N total = 1 victim + (N-1) suspects; N determined by difficulty (5/6/9/12), minimum N=5
- Naming convention: victim name starts with V; suspects start with A, B, C, D, E, F, … (alphabetically)
- One person per row, one per column (Latin square constraint)
- People cannot be placed on non-occupiable object cells

**Win condition:**
- The murderer is the suspect alone in the same room as the victim (exactly 2 people in that room)

**Clue types:**
- `person-direction` — "A is northwest of B" (diagonal) or "A is north of B" (row comparison only, any column)
- `person-distance` — "A is exactly 2 columns east of B" (column/row distance only, no row/col alignment required)
- `person-beside-object` — "A is beside a table" (orthogonally adjacent, same room only)
- `person-on-object` — "A is sitting at the chair"
- `person-in-room` — "A is in the kitchen"
- `persons-same-room` — "A is in the same room as B"
- `person-alone-in-room` — "A is alone in the library" (encodes `roomId`; implies person-in-room for that room)
- `room-population` — "The library has exactly 2 people"
- `object-occupancy` — "Exactly one chair is occupied"
- `person-not-in-room` — "A is not in the ballroom"
- `persons-not-same-room` — "A and B are not in the same room"
- `person-in-room-with` — "A is in a room with exactly 2 other people"
- `person-in-row` — "A is in row 3" (1-indexed)
- `person-in-col` — "A is in column 2" (1-indexed)
- `person-in-corner` — "A is in a corner of the grid" (one of the 4 grid corners)
- `person-in-room-corner` — "A is in a corner of the Library" (cell with two perpendicular room walls)
- `person-sole-occupant` — "A is the only person sitting on a chair" (sole occupant across all instances of that object kind)
- `empty-rooms` — "Exactly 2 rooms are empty" (general clue)
- Clues always yield exactly one valid solution

**Direction semantics:**
- Cardinal (N/S/E/W): row or column comparison only — "A is north of B" means A.row < B.row regardless of column
- Diagonal (NE/NW/SE/SW): both row and column — "A is northeast of B" means A.row < B.row AND A.col > B.col

---

## Architecture

**Two completely separate parts:**
1. **CLI tool** — developer-only, generates puzzles locally, never deployed
2. **Frontend** — static React app, puzzles hardcoded in JSON, deployed to GitHub Pages

**No backend.** The frontend is a single self-contained `index.html`.

---

## Project Structure

```
murdoku/
├── shared/                    # Shared by CLI + frontend (no Node-only APIs)
│   ├── types.ts               # ALL TypeScript types — single source of truth
│   ├── solver.ts              # Backtracking + constraint propagation solver
│   └── clue-evaluator.ts      # Per-clue-kind evaluators used by solver
│
├── cli/                       # Developer puzzle generator (never bundled)
│   ├── generate.ts            # Entry: npm run generate [--count=N] [--difficulty=easy|medium|hard|very-hard] [--debug]
│   ├── llm-client.ts          # Vercel AI SDK + Gemini (theme + all clue texts)
│   ├── layout-builder.ts      # Voronoi BFS room partitioning + object placement
│   ├── placer.ts              # Latin-square backtracking placer; assigns people to cells after backtracking
│   ├── clue-generator.ts      # computeAllFacts() — derives all true facts
│   └── output.ts              # Read/write src/puzzles/puzzles.json
│
├── src/
│   ├── App.tsx                # Root: puzzle selection + completed state (localStorage)
│   ├── puzzles/
│   │   └── puzzles.json       # Generated puzzles (committed, bundled at build)
│   └── components/
│       ├── GridCanvas.tsx     # Layered CSS Grid: rooms→objects→cells→marks
│       ├── Cell.tsx           # Single cell with room-boundary borders + click handler
│       ├── ObjectSprite.tsx   # Lucide icon spanning grid cells
│       ├── CellPopup.tsx      # Popup to toggle person/X marks on a cell
│       ├── CluesPanel.tsx     # Scrollable evidence list
│       ├── ClueItem.tsx       # Single clue with kind icon + text
│       ├── PuzzleView.tsx     # Full puzzle layout (grid + clues + controls)
│       └── PuzzleSelector.tsx # Puzzle picker grouped by difficulty (easy/medium/hard/very-hard)
│
├── public/
│   ├── icon.svg               # PWA home screen icon (512×512, dark bg + 🕵️)
│   ├── manifest.json          # PWA manifest (standalone display, theme colour)
│   └── sw.js                  # Service worker — cache-first, caches index.html
├── .github/workflows/
│   └── deploy.yml             # GitHub Actions: build + deploy to GitHub Pages
├── index.html
├── vite.config.ts             # viteSingleFile plugin — outputs single index.html
├── tsconfig.json              # Base config
├── tsconfig.app.json          # Frontend config (includes shared/)
└── tsconfig.cli.json          # CLI config (NodeNext modules)
```

---

## Tech Stack

- **Frontend:** React 19 + TypeScript, Vite, `vite-plugin-singlefile`
- **CLI:** TypeScript via `tsx`, Vercel AI SDK (`ai` + `@ai-sdk/google`), Zod
- **LLM:** Google Gemini (`gemini-2.0-flash`) — requires `GEMINI_API_KEY`
- **Hosting:** GitHub Pages (single `index.html`)
- **PWA:** manual manifest + cache-first service worker; no extra plugin (avoids conflict with `viteSingleFile`); all URLs relative (`./`) so works under the `/murdoku/` subpath without a Vite `base` change
- **Linting:** `eslint-plugin-prettier` (prettier as ESLint rule — single `npm run lint` command); tabs, single quotes, semicolons, 100-char print width. Pre-commit hook runs `lint-fix`; pre-push hook runs `lint` (via Husky). When editing TSX/TS files directly, just make the change and run `npm run lint-fix` at the end — no need to match exact tab indentation in edits.

---

## Key Commands

```bash
npm run dev                                                                      # Dev server
npm run build                                                                    # Build → dist/index.html (single file)
npm run clear-puzzles                                                            # Reset puzzles.json to empty
GEMINI_API_KEY=your_key npm run generate                                         # Generate 1 medium puzzle (6×6)
GEMINI_API_KEY=your_key npm run generate -- --count=5                           # Generate 5 puzzles
GEMINI_API_KEY=your_key npm run generate -- --difficulty=easy                   # Generate an easy puzzle (5×5)
GEMINI_API_KEY=your_key npm run generate -- --difficulty=hard                   # Generate a hard puzzle (9×9)
GEMINI_API_KEY=your_key npm run generate -- --difficulty=very-hard              # Generate a very-hard puzzle (12×12)
GEMINI_API_KEY=your_key npm run generate -- --debug                             # Print all LLM prompts/responses
```

---

## CLI Generation Pipeline

```
1. LLM  → theme (title, subtitle, room names, patterns, character names/emojis, murdererInitial)
           victim name starts with V; suspects start with A, B, C, D, E, …
           LLM also picks which suspect is the murderer (murdererInitial)
           temperature=1.5 for maximum variety
2. Algo → grid layout (weighted Voronoi BFS room partitioning + object placement)
           - LLM provides `sizePercentage` per room; BFS expands the room most behind its
             target proportion at each step (single seed per room preserves contiguity)
           - Object placement: Phase 1 backtracks to place required objects (one per required kind,
             trying all valid shapes/rotations); Phase 2 greedily places optional objects (~1 per 4 cells)
           - requiredObjects capped at 1 for N≤6, 2 for N>6
3. Algo → valid placement (backtracking Latin-square placer)
           enforces: 1/row, 1/col, no non-occupiable cells,
           some room has exactly 2 people; after backtracking, people are
           assigned to cells: victim+murderer → the 2-person room (murderer
           is the LLM-chosen suspect), remaining suspects → other cells
4. Algo → computeAllFacts() — exhaustive list of all true statements; victim facts excluded
           (person, personA, and personB === victimId all filtered out)
           facts are weighted and sorted: person-direction/distance (weight 1) first,
           all others (weight 5) last
5. Algo → minimize pass — greedily remove redundant clues while maintaining
           (a) unique solution and (b) ≥1 clue per suspect
           (lower-weight clues tried first → person-direction/distance pruned preferentially)
           after minimization: reject puzzle if any suspect is still pinned by their clues
           alone (evaluated in isolation); retry up to 20× per theme
           store solver backtracking count as `backtrackingScore` on the puzzle
6. LLM  → generateAllTexts() — single LLM call produces:
           - one summary sentence per suspect (covering all their clue facts)
           - natural language text for each general clue (room-population, object-occupancy)
           temperature=0.4 for accurate factual prose; all numbers written out in words
           (e.g. "two" not "2", "third" not "3rd"); victim clue hardcoded in UI, never stored
7. Auto-save → append to src/puzzles/puzzles.json
```

**Key design principle:** LLM handles creative content only (theme, clue text phrasing). All clue selection and constraint satisfaction is fully algorithmic.

---

## Data Model (shared/types.ts)

Two-level type hierarchy:

```typescript
// Base — used by solver, evaluator, and CLI generator
Puzzle {
  gridSize, rooms, objects, people, clues, solution
}

// Full stored record — extends Puzzle, used by the frontend
FullPuzzle extends Puzzle {
  id, title, subtitle, difficulty, suspectSummaries, generatedAt, backtrackingScore
}

PuzzleCollection { version, puzzles: FullPuzzle[] }
```

`clues` is a discriminated union of all clue kinds; each carries a `.text` field with LLM-written prose. `suspectSummaries` holds one sentence per suspect combining all their facts (used for UI display). `backtrackingScore` is the solver's backtracking count on the minimized clue set — used as a difficulty signal and shown in the puzzle selector. The victim clue is hardcoded in the UI ("The victim is alone in a room with the murderer.") and never stored in `clues`.

**`person-alone-in-room` encodes `roomId`:** This clue stores the room explicitly, so the evaluator can prune immediately if any other person enters that room — making `room-population count=1` for the same room genuinely redundant and removable by the minimizer.

---

## Solver (shared/solver.ts)

- `solve(puzzle, clues) → { status: 'unique'|'multiple'|'none', ... }` — unique result includes `metrics: { backtracks }` where `backtracks = Σ(domain.length - 1)` across all branching decisions (order-independent)
- Backtracking with early pruning via clue evaluators
- **`computeDomain(pid, assignment)`** — computes valid cells for a person given the current partial assignment. Temporarily places the candidate cell in the assignment and calls `evaluateClue` for all relevant clues; any `'violated'` result eliminates the cell. `'unknown'` passes through (partner not yet placed).
- **Clue evaluators** (`shared/clue-evaluator.ts`) — per-kind constraint checks returning `'satisfied' | 'violated' | 'unknown'`. All O(1) via a per-puzzle WeakMap cache (coordToRoomId, coordToObjects, coordToAdjacentKinds, occupiableCoordToObj). Direction/distance evaluators also return `'violated'` for geometrically impossible partial placements (e.g. "A is N of B" → if only A is placed in the last row, violated immediately).
- **Murder condition** — encoded as an implicit `person-in-room-with` global clue (victim must be with exactly 1 other person). Pruned mid-search, not just at leaves.
- **Backtrack loop:**
  1. *Compute domains* — `computeDomain` for every unplaced person
  2. *Propagate* — iterate until stable:
     - **Row/col locking**: if all of a person's domain cells share one row (or col), reserve that row/col for them and remove it from everyone else's domains
     - **2-cell cross elimination**: if domain = `{(r1,c1),(r2,c2)}` with r1≠r2 and c1≠c2, cells `(r1,c2)` and `(r2,c1)` are forbidden for all (proven: Latin square blocks both cross-cells regardless of which the person takes)
     - Contradiction (empty domain or two people locked to same row/col) → prune branch
  3. *MRV* — pick unplaced person with fewest remaining cells
  4. *Branch* — try each cell in MRV winner's propagated domain
- **Leaf verification** — all input clues checked for `'satisfied'` (person clues: defensive; global clues: necessary since they stay `'unknown'` mid-search); implicit victim clue verified separately
- Used by CLI for uniqueness verification; also available for browser hint system

---

## Frontend Rendering

Grid uses **layered CSS Grid** (not SVG/Canvas):
1. Room background fills — pattern rendered per-cell via CSS gradients (`solid` = flat tint, `striped` = 4 vertical bands, `checkered` = 2×2 quad split); `ROOM_ALPHA = '88'` (~53% opacity) appended to each hex color
2. Room name labels (topmost-leftmost actual room cell — never outside the room)
3. Cell borders (thick = room boundary, thin = intra-room) + click targets
4. Object sprites (Lucide icon + label, spanning correct grid cells)
5. Cell marks — player annotations (person initial in purple/red/green, or ✕); when solution is revealed, solution placements shown as committed (green) using the same marks layer

**Interactive solving:** clicking an occupiable cell opens a popup (`CellPopup`) with one button per person (initial letter) plus an X. Clicking a letter toggles that mark on the cell (multiple people per cell allowed; X is exclusive). Marks persist in `localStorage` per puzzle (`murdoku-progress-{id}`). Locked cells persist separately (`murdoku-committed-{id}`).

**Lock ✓:** popup shows a green "Lock ✓" button (active only when exactly one person is marked). Locking: (1) removes that person from all other cells, (2) crosses out all other occupiable cells in the same row/col that aren't already locked, (3) turns the letter green on the grid. When all people are locked, auto-checks the solution: correct → green banner ("X killed Y in the Z") + all letters locked; wrong → specific hint. Action is undoable.

**Verify Solution:** available at any time (also runs automatically when all people are locked). Implemented as `runVerify(marks)` — reused by both the button and auto-lock. Checks in priority order: (1) multiple marks on a cell, (2) duplicate person placement (lists all names), (3) someone not yet placed, (4) row/column conflict (names the two people), (5) first violated clue (shows the clue text), (6) victim clue (victim not alone with murderer). Only one hint shown at a time.

**Solution reveal:** "Reveal Solution" button sits below the evidence panel (clues column). Clicking it shows all placements as locked (green) on the grid — no modal. A "Hide Solution" button appears below the grid to return to normal view.

**Completed puzzles:** stored in `localStorage` (`murdoku-completed`). `PuzzleSelector` shows completed puzzles in green with a ✓ prefix, grouped by difficulty (Easy / Medium / Hard / Very Hard). A Reset button clears completion and progress.

Layout: mobile (<640px) → grid stacked above clues; desktop → side by side.

---

## Status: Complete

- [x] CLI puzzle generator with LLM + algorithmic pipeline
- [x] Frontend renders grid, rooms, objects, clues
- [x] Solution reveal (placements shown on grid; no modal)
- [x] Puzzle selector grouped by difficulty (Easy / Medium / Hard / Very Hard)
- [x] Interactive solving — click cells to annotate with person initials or X
- [x] Verify Solution — specific hints (unplaced, conflicts, violated clue)
- [x] Progress + completed state persisted in localStorage
- [x] Single-file build deployable to GitHub Pages
- [x] GitHub Actions auto-deploy on push to main
- [x] PWA — installable, works offline after first visit
- [x] Clear board button — wipes marks without affecting completed state
- [x] How to play collapsible section in the puzzle UI
- [x] Lock mechanic — lock in placements; auto-verifies when all locked
- [x] Puzzle/FullPuzzle type split — base type for solver/evaluator/generator; FullPuzzle for frontend/storage
- [x] `StoredClue = Clue & { text: string }` — `text` removed from base `Clue` type; only stored/displayed variants carry it
- [x] Room builder — weighted Voronoi BFS with farthest-point seeding, per-room frontiers, and phase 2 cell-stealing correction for exact target sizes
- [x] Object placement — multi-shape support (rug has 5 base shapes); free-adjacent constraint correctly validated against all placed objects
- [x] New object types: car (1×2, occupiable), rug (1×1 to 2×3, occupiable), tv (1×1, non-occupiable)
- [x] Room labels placed in widest row instead of topmost row
- [x] Difficulty overhaul — easy(5×5)/medium(6×6)/hard(9×9)/very-hard(12×12); victim clue required for all except easy
- [x] LLM picks the murderer — `murdererInitial` in theme schema; plausible/surprising culprit per prompt
- [x] Object placement bug fixes — required objects now placed once per kind (not once per rotation slot); `unplaceTemplate` uses exact id match to avoid removing the wrong object
- [x] Removed `MurdererReveal.tsx` (unused component)
- [x] Solver metrics — `SolveMetrics { backtracks }` returned from `solve()` on unique result; order-independent count (`Σ domain.length - 1` per branching decision)
- [x] `backtrackingScore` stored on `FullPuzzle`; displayed in puzzle selector next to title
- [x] PNG sprite support in `ObjectSprite` — `OBJECT_SPRITES` map overrides icon+label with full-cell image when present
- [x] De-pin pass removed; post-minimize pin check discards and retries (up to 20×) instead of mutating
- [x] Verify refactor — `runVerify(marks)` shared between button and auto-lock; victim clue check added; duplicate placement lists all names
- [x] `--debug` flag gates all verbose step logs; clean output by default
- [x] LLM prompt fix — prevent "alone" for object-occupancy clues

## Future Ideas

- App icon
- Object sprites
- Non-square grids
- Daily puzzle
