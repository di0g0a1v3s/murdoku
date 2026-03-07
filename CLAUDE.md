# Murdoku — Project Context for Claude

## What is Murdoku

A logic puzzle game combining murder mystery storytelling with Sudoku-style grid constraints. Players deduce the positions of all suspects on a grid to identify the murderer.

**Live site:** https://di0g0a1v3s.github.io/murdoku/
**Repo:** https://github.com/di0g0a1v3s/murdoku

---

## Game Rules

**Grid:**
- N×N grid (default 6×6, configurable via `--people=N`), divided into named rooms
- Cells can be: empty, occupiable object (chair, bed, sofa...), or non-occupiable object (table, plant, bookshelf…)
- Objects can span multiple cells

**People:**
- N total = 1 victim + (N-1) suspects; default N=6, minimum N=4
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
│   ├── generate.ts            # Entry: npm run generate [--count=N] [--people=N] [--debug]
│   ├── llm-client.ts          # Vercel AI SDK + Gemini (theme + all clue texts)
│   ├── layout-builder.ts      # Voronoi BFS room partitioning + object placement
│   ├── placer.ts              # Latin-square backtracking placer
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
│       ├── PuzzleSelector.tsx # Puzzle picker grouped by difficulty, completed state
│       └── MurdererReveal.tsx # Modal shown when solution revealed
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
- **Linting:** `eslint-plugin-prettier` (prettier as ESLint rule — single `npm run lint` command); tabs, single quotes, semicolons, 100-char print width. Pre-commit hook runs `lint-fix`; pre-push hook runs `lint` (via Husky).

---

## Key Commands

```bash
npm run dev                                                       # Dev server
npm run build                                                     # Build → dist/index.html (single file)
npm run clear-puzzles                                             # Reset puzzles.json to empty
GEMINI_API_KEY=your_key npm run generate                          # Generate 1 puzzle (6×6)
GEMINI_API_KEY=your_key npm run generate -- --count=5            # Generate 5 puzzles
GEMINI_API_KEY=your_key npm run generate -- --people=4           # Generate a 4×4 puzzle
GEMINI_API_KEY=your_key npm run generate -- --debug              # Print all LLM prompts/responses
```

---

## CLI Generation Pipeline

```
1. LLM  → theme (title, subtitle, room names, patterns, character names/emojis)
           victim name starts with V; suspects start with A, B, C, D, E
           temperature=1.5 for maximum variety
2. Algo → grid layout (weighted Voronoi BFS room partitioning + object placement)
           - LLM provides `sizePercentage` per room; BFS expands the room most behind its
             target proportion at each step (single seed per room preserves contiguity)
           - Object placement: Phase 1 backtracks to place required objects; Phase 2 greedily
             places optional objects (~1 per 4 room cells)
3. Algo → valid placement (backtracking Latin-square placer)
           enforces: 1/row, 1/col, no non-occupiable cells,
           victim's room has exactly 2 people (victim + murderer)
4. Algo → computeAllFacts() — exhaustive list of all true statements (victim facts excluded)
           facts are weighted and sorted: person-direction/distance (weight 1) first,
           all others (weight 5) last
5. Algo → de-pin pass — remove any clue whose removal still leaves the suspect
           with ≥1 clue but no longer individually pinned to one cell
           (no uniqueness check; pool is large enough to absorb removals)
6. Algo → minimize pass — greedily remove redundant clues while maintaining
           (a) unique solution and (b) ≥1 clue per suspect
           (lower-weight clues tried first → person-direction/distance pruned preferentially)
7. LLM  → generateAllTexts() — single LLM call produces:
           - one summary sentence per suspect (covering all their clue facts)
           - natural language text for each general clue (room-population, object-occupancy)
           temperature=0.4 for accurate factual prose
           victim clue is fixed ("alone with murderer") and never stored
8. Auto-save → append to src/puzzles/puzzles.json
```

**Key design principle:** LLM handles creative content only (theme, clue text phrasing). All clue selection and constraint satisfaction is fully algorithmic.

---

## Data Model (shared/types.ts)

```typescript
Puzzle {
  id, title, subtitle, gridSize, generatedAt
  rooms: Room[]          // each room owns its cells + has a RoomPattern (solid | striped | checkered)
  objects: GridObject[]  // kind, occupiable|non-occupiable, cells[]
  people: Person[]       // role: 'victim' | 'suspect', avatarEmoji
  clues: Clue[]          // discriminated union; each clue's .text = raw description (used by solver audit)
  suspectSummaries: { personId: string; text: string }[]
                         // one LLM-written sentence per suspect (used for UI display)
  solution: {
    placements: { personId, coord }[]
    murdererId, victimId, murderRoom
  }
}
```

**Display vs solver split:** `suspectSummaries` holds one LLM-generated sentence per suspect that combines all their facts for display. General clue `text` fields hold LLM-naturalized text rendered directly in the UI. The victim clue is hardcoded in the UI ("The victim is alone in a room with the murderer.") and never stored in `clues`.

**`person-alone-in-room` encodes `roomId`:** This clue stores the room explicitly, so the evaluator can prune immediately if any other person enters that room — making `room-population count=1` for the same room genuinely redundant and removable by the minimizer.

---

## Solver (shared/solver.ts)

- `solve(puzzle, clues) → { status: 'unique'|'multiple'|'none', ... }`
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
5. Cell marks — player annotations (person initial in purple/red, or ✕); when solution is revealed, solution placements are shown using the same marks layer

**Interactive solving:** clicking an occupiable cell opens a popup (`CellPopup`) with one button per person (initial letter) plus an X. Clicking a letter toggles that mark on the cell (multiple people per cell allowed; X is exclusive). Popup closes after each selection. Marks persist in `localStorage` per puzzle (`murdoku-progress-{id}`).

**Verify Solution:** button checks that user's marks exactly match the solution placements (one person per cell, all placed, nothing extra; X marks ignored). Correct → green banner + marks puzzle complete. Wrong → red hint message.

**Completed puzzles:** stored in `localStorage` (`murdoku-completed`). `PuzzleSelector` shows completed puzzles in green with a ✓ prefix, grouped by difficulty (Easy ≤6 people, Medium 7–9, Hard 10+). A Reset button clears completion and progress.

Layout: mobile (<640px) → grid stacked above clues; desktop → side by side.

---

## Status: Complete

- [x] CLI puzzle generator with LLM + algorithmic pipeline
- [x] Frontend renders grid, rooms, objects, clues
- [x] Solution reveal (letter marks + murderer modal)
- [x] Puzzle selector grouped by difficulty (Easy/Medium/Hard)
- [x] Interactive solving — click cells to annotate with person initials or X
- [x] Verify Solution — checks marks against solution, marks puzzle complete
- [x] Progress + completed state persisted in localStorage
- [x] Single-file build deployable to GitHub Pages
- [x] GitHub Actions auto-deploy on push to main
- [x] PWA — installable, works offline after first visit

## Future Ideas

- Higher res icon
- More object types: rug, tv, car
- Non-square grids
- Hint system using the solver
- Daily puzzle
- Undo
- Clean board
