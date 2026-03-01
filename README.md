# 🕵️ Murdoku

**Murder Mystery Logic Puzzles** — a logic puzzle game combining the deduction of murder mysteries with the grid constraints of Sudoku.

> Place every suspect on the grid. Find who was alone with the victim. Solve the case.

**[▶ Play online](https://di0g0a1v3s.github.io/murdoku/)**

---

## How to Play

Murdoku presents you with a grid divided into rooms. Your goal is to place all suspects (and the victim) on the grid using the clues provided.

**Rules:**
- One person per row, one per column (like Sudoku)
- People cannot occupy cells blocked by non-occupiable objects (tables, plants, etc.)
- The **murderer** is the suspect who ends up **alone in the same room as the victim**
- The clues always yield exactly one valid solution

**Clue types:**
- Directional — *"A is north of B"* (row comparison), *"A is northeast of B"* (both row and column)
- Distance — *"A is 2 columns east of B"* (column distance only, any row)
- Object-relative — *"A is beside a chair"*, *"A is sitting in a chair"*
- Room-based — *"A is in the library"*, *"A is in the same room as B"*, *"A is alone in the library"*
- General — *"Exactly one chair is occupied"*

---

## Project Structure

```
murdoku/
├── shared/               # Types and logic shared by CLI + frontend
│   ├── types.ts          # Canonical data model (Puzzle, Room, Clue, etc.)
│   ├── solver.ts         # Backtracking solver (uniqueness verification)
│   └── clue-evaluator.ts # Per-clue-kind constraint evaluators
│
├── cli/                  # Developer tool — puzzle generator
│   ├── generate.ts       # Entry point: npm run generate
│   ├── llm-client.ts     # Vercel AI SDK + Gemini (theme & clue text)
│   ├── layout-builder.ts # Room partitioning + object placement
│   ├── placer.ts         # Latin-square backtracking placer
│   ├── clue-generator.ts # Derives all true facts from a placement
│   └── output.ts         # Reads/writes src/puzzles/puzzles.json
│
└── src/                  # React frontend
    ├── App.tsx
    ├── puzzles/
    │   └── puzzles.json  # Generated puzzles (bundled into the build)
    └── components/
        ├── GridCanvas.tsx
        ├── CluesPanel.tsx
        ├── PuzzleView.tsx
        └── ...
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript |
| Bundler | Vite + `vite-plugin-singlefile` (outputs a single `index.html`) |
| Hosting | GitHub Pages |
| CLI | TypeScript via `tsx` |
| LLM | Vercel AI SDK + Google Gemini |
| Structured output | Zod |

---

## Generating Puzzles

Puzzles are generated locally by the developer and committed to the repo. The frontend has them hardcoded at build time.

**Prerequisites:** a [Google Gemini API key](https://aistudio.google.com/app/apikey).

```bash
# Install dependencies
npm install

# Generate one puzzle (default 6×6)
GEMINI_API_KEY=your_key_here npm run generate

# Generate multiple puzzles at once
GEMINI_API_KEY=your_key_here npm run generate -- --count=5

# Generate a puzzle with N people on an N×N grid (minimum 4)
GEMINI_API_KEY=your_key_here npm run generate -- --people=4

# Combine flags
GEMINI_API_KEY=your_key_here npm run generate -- --count=3 --people=8

# Clear all puzzles
npm run clear-puzzles
```

The generator will:
1. Call Gemini to create a theme (title, rooms, characters, atmosphere)
2. Algorithmically build the grid layout and place all people
3. Algorithmically derive every possible true fact from the placement
4. Remove any clues that would let a player trivially pin a suspect without cross-suspect reasoning
5. Minimize the clue set — greedily remove redundant clues while keeping a unique solution
6. Call Gemini once to write all suspect summaries and general clue texts
7. Automatically save to `src/puzzles/puzzles.json`

Add `--debug` to print all LLM prompts and responses:

```bash
GEMINI_API_KEY=your_key_here npm run generate -- --debug
```

After generating, commit and push — GitHub Actions will rebuild and redeploy automatically.

---

## Development

```bash
npm run dev      # Start local dev server
npm run build    # Build single-file dist/index.html
npm run preview  # Preview the production build
```

---

## Puzzle Generation Pipeline

```
LLM → theme (title, rooms, characters)
  ↓
Algorithm → grid layout (Voronoi BFS room partitioning + object placement)
  ↓
Algorithm → valid placement (backtracking Latin-square solver)
            enforces: 1 person/row, 1 person/col, murder room = exactly 2 people
  ↓
Algorithm → derive ALL true facts from the placement (shuffled for variety,
            then sorted by weight: direction/distance clues first so they are
            pruned preferentially)
  ↓
Algorithm → de-pin: remove clues that let a player trivially locate a suspect
            without any cross-suspect reasoning
  ↓
Algorithm → minimize: greedily remove redundant clues while keeping
            (a) unique solution and (b) ≥1 clue per suspect
  ↓
LLM → single call writes one summary sentence per suspect + naturalizes
      any remaining general clues (room-population, object-occupancy)
  ↓
Auto-save → puzzles.json
```

The LLM is only used for **creative content** (theme, clue text phrasing). All clue selection and constraint satisfaction is handled algorithmically.
