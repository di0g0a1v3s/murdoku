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
- Directional — *"A is north of B"*, *"A is 2 columns east of B"*
- Object-relative — *"A is beside a chair"*, *"A is sitting at the desk"*
- Room-based — *"A is in the library"*, *"A is in the same room as B"*, *"A is alone in their room"*
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
│   ├── llm-client.ts     # Vercel AI SDK + Gemini (theme & clue generation)
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

# Run the generator
GEMINI_API_KEY=your_key_here npm run generate
```

The generator will:
1. Call Gemini to create a theme (title, rooms, characters, atmosphere)
2. Algorithmically build the grid layout and place all people
3. Call Gemini to select which facts to use as clues
4. Verify the puzzle has a unique solution; remove any redundant clues
5. Call Gemini to write one summary sentence per suspect
6. Automatically save to `src/puzzles/puzzles.json`

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
Algorithm → derive ALL true facts from the placement
  ↓
LLM → select fact indices (no text generated yet)
  ↓
Algorithm → ensure every suspect has ≥1 clue (adds programmatic clues if needed)
  ↓
Solver → verify unique solution (backtrack with limit=2)
         if none: regenerate clues (up to 3×)
         if multiple: add discriminating facts until unique (up to 5×)
  ↓
Algorithm → minimize clue set (remove redundant clues one by one)
  ↓
LLM → write one summary sentence per suspect (covering all their clues)
  ↓
Auto-save → puzzles.json
```

The LLM is only trusted for **creative content** (names, atmosphere, clue prose). All constraint satisfaction is handled algorithmically.
