# Murdoku — Project Context for Claude

## What is Murdoku

A logic puzzle game combining murder mystery storytelling with Sudoku-style grid constraints. Players deduce the positions of all suspects on a grid to identify the murderer.

**Live site:** https://di0g0a1v3s.github.io/murdoku/
**Repo:** https://github.com/di0g0a1v3s/murdoku

---

## Game Rules

**Grid:**
- Any size grid (Phase 1 uses 6×6), divided into named rooms
- Cells can be: empty, occupiable object (chair, bed, sofa, desk…), or non-occupiable object (table, plant, bookshelf…)
- Objects can span multiple cells

**People:**
- N total = 1 victim + (N-1) suspects
- One person per row, one per column (Latin square constraint)
- People cannot be placed on non-occupiable object cells
- Multi-cell objects: if cells share a row or column → max 1 person; if 2×2 block → max 2 people in opposite corners

**Win condition:**
- The murderer is the suspect alone in the same room as the victim (exactly 2 people in that room)

**Clue types:**
- `person-direction` — "A is northwest of B"
- `person-distance` — "A is exactly 2 columns east of B"
- `person-beside-object` — "A is beside a table" (orthogonally adjacent, same room only)
- `person-on-object` — "A is sitting at the desk"
- `person-in-room` — "A is in the kitchen"
- `persons-same-room` — "A is in the same room as B"
- `person-alone-in-room` — "A is alone in their room"
- `room-population` — "The library has exactly 2 people"
- `object-occupancy` — "Exactly one chair is occupied"
- `person-not-in-room` — "A is not in the ballroom"
- `persons-not-same-room` — "A and B are not in the same room"
- Clues always yield exactly one valid solution

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
│   ├── generate.ts            # Entry: npm run generate
│   ├── llm-client.ts          # Vercel AI SDK + Gemini (theme & clue generation)
│   ├── layout-builder.ts      # Voronoi BFS room partitioning + object placement
│   ├── placer.ts              # Latin-square backtracking placer
│   ├── clue-generator.ts      # computeAllFacts() — derives all true facts
│   └── output.ts              # Read/write src/puzzles/puzzles.json
│
├── src/
│   ├── App.tsx                # Root: puzzle selection + showSolution state
│   ├── puzzles/
│   │   └── puzzles.json       # Generated puzzles (committed, bundled at build)
│   └── components/
│       ├── GridCanvas.tsx     # Layered CSS Grid: rooms→objects→cells→tokens
│       ├── Cell.tsx           # Single cell with room-boundary borders
│       ├── ObjectSprite.tsx   # Emoji icon spanning grid cells
│       ├── PersonToken.tsx    # Suspect/victim token (shown on reveal)
│       ├── CluesPanel.tsx     # Scrollable evidence list
│       ├── ClueItem.tsx       # Single clue with kind icon + text
│       ├── PuzzleView.tsx     # Full puzzle layout (grid + clues + controls)
│       ├── PuzzleSelector.tsx # Puzzle picker (shown when >1 puzzle)
│       └── MurdererReveal.tsx # Modal shown when solution revealed
│
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

---

## Key Commands

```bash
npm run dev                              # Dev server
npm run build                            # Build → dist/index.html (single file)
GEMINI_API_KEY=your_key npm run generate # Generate a new puzzle
```

---

## CLI Generation Pipeline

```
1. LLM  → theme (title, subtitle, room names, colors, character names/emojis)
2. Algo → grid layout (Voronoi BFS room partitioning + random object placement)
3. Algo → valid placement (backtracking Latin-square placer)
           enforces: 1/row, 1/col, no non-occupiable cells,
           victim's room has exactly 2 people (victim + murderer)
4. Algo → computeAllFacts() — exhaustive list of all true statements
5. LLM  → pick minimal clue subset, write atmospheric mystery prose for each
6. Solver → verify unique solution (backtrack limit=2)
            if multiple solutions: add programmatic clues from unused facts
7. Y/N prompt → append to src/puzzles/puzzles.json
```

**Key design principle:** LLM handles creative content only. All constraint satisfaction (placement, uniqueness) is algorithmic.

---

## Data Model (shared/types.ts)

```typescript
Puzzle {
  id, title, subtitle, gridSize, generatedAt
  rooms: Room[]          // each room owns its cells + has a CSS color
  objects: GridObject[]  // kind, occupiable|non-occupiable, cells[]
  people: Person[]       // role: 'victim' | 'suspect', avatarEmoji
  clues: Clue[]          // discriminated union, each variant has text: string
  solution: {
    placements: { personId, coord }[]
    murdererId, victimId, murderRoom
  }
}
```

Clues store pre-generated `text` (atmospheric prose written by LLM at generation time). The frontend just renders the string — no runtime string building.

---

## Solver (shared/solver.ts)

- `solve(puzzle, clues, limit?) → { status: 'unique'|'multiple'|'none', ... }`
- Backtracking with early pruning via clue evaluators
- MRV heuristic (most-constrained person first)
- Used by CLI for uniqueness verification; also available for browser in Phase 2

---

## Frontend Rendering

Grid uses **layered CSS Grid** (not SVG/Canvas):
1. Room background fills (color at ~33% opacity)
2. Room name labels (top-left of each room's bounding box)
3. Cell borders (thick = room boundary, thin = intra-room)
4. Object sprites (emoji icon + label, spanning correct grid cells)
5. Person tokens (shown only when `showSolution=true`)

Layout: mobile (<640px) → grid stacked above clues; desktop → side by side.

---

## Phase 1 Status: Complete

- [x] CLI puzzle generator with LLM + algorithmic pipeline
- [x] Frontend renders grid, rooms, objects, clues
- [x] Solution reveal (person tokens + murderer modal)
- [x] Puzzle selector for multiple puzzles
- [x] Single-file build deployable to GitHub Pages
- [x] GitHub Actions auto-deploy on push to main

## Phase 2 Ideas (not started)

- Interactive solving (click/drag to place suspects)
- Hint system using the solver
- Difficulty ratings
- Puzzle timer
- More clue types
