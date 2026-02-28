import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { Clue, Person, Room } from '../shared/types.js'
import { trackUsage } from './cost-tracker.js'

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? '',
})

const model = google('gemini-2.0-flash')

// ─── Theme Generation ─────────────────────────────────────────────────────────

const ThemeSchema = z.object({
  title: z.string().describe('A dramatic murder mystery title'),
  subtitle: z.string().describe('A short atmospheric tagline'),
  setting: z.string().describe('Brief description of the setting/atmosphere'),
  roomNames: z.array(z.string()).length(6).describe('Exactly 6 room names for this setting'),
  roomColors: z.array(z.string()).length(6).describe('Exactly 6 hex color codes (e.g. #F5E6D3) — muted, distinct, atmospheric'),
  people: z.array(z.object({
    name: z.string(),
    avatarEmoji: z.string().describe('A single emoji representing this person'),
  })).length(6).describe('Exactly 6 people: the first is the VICTIM, the rest are suspects'),
})

export interface PuzzleTheme {
  title: string
  subtitle: string
  setting: string
  people: Person[]
  rooms: Pick<Room, 'id' | 'name' | 'color'>[]
}

export async function generateTheme(): Promise<PuzzleTheme> {
  const { object, usage } = await generateObject({
    model,
    schema: ThemeSchema,
    prompt: `You are designing a murder mystery logic puzzle called Murdoku.
Create a unique and atmospheric theme for a 6-person puzzle set in an interesting location.

Requirements:
- Title should be dramatic and evocative
- Setting can be any interesting location (manor, ship, library, theatre, casino, monastery, etc.)
- Room names should fit the setting naturally (6 rooms total)
- Room colors should be muted, distinct pastels that evoke the mood (hex codes)
- 6 people: first person is the VICTIM, others are suspects
- Names should be memorable and fit the setting's era/style
- Each person gets one emoji avatar

Make it creative and varied — avoid clichés.`,
  })

  trackUsage('Theme generation', usage)

  const rooms = object.roomNames.map((name, i) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    color: object.roomColors[i]!,
  }))

  const people: Person[] = object.people.map((p, i) => ({
    id: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: p.name,
    role: i === 0 ? 'victim' : 'suspect',
    avatarEmoji: p.avatarEmoji,
  }))

  return {
    title: object.title,
    subtitle: object.subtitle,
    setting: object.setting,
    rooms,
    people,
  }
}

// ─── Clue Generation ──────────────────────────────────────────────────────────

export interface DerivableFact {
  description: string
  clue: Clue
}

// LLM only selects fact indices and writes atmospheric text — never generates constraint values
const ClueSelectionSchema = z.array(z.object({
  factIndex: z.number().int().min(0).describe('0-based index into the facts array'),
  text: z.string().describe('Atmospheric in-world mystery flavor text for this clue'),
}))

export async function generateClues(
  theme: PuzzleTheme,
  facts: DerivableFact[],
  targetCount: number = 10,
): Promise<Clue[]> {
  const factsText = facts.map((f, i) => `${i} (${f.clue.kind}): ${f.description}`).join('\n')

  const { object, usage } = await generateObject({
    model,
    schema: z.object({ selections: ClueSelectionSchema }),
    prompt: `You are writing clues for a Murdoku puzzle (murder mystery + logic grid).

SETTING: ${theme.title}
${theme.setting}

PUZZLE SOLUTION FACTS (indexed 0 to ${facts.length - 1}):
${factsText}

TASK: Select exactly ${targetCount} facts from the list above that, together, uniquely identify where every person is located. For each selected fact, write one sentence of atmospheric mystery flavor text.

Rules:
1. Output exactly ${targetCount} selections, each with a valid factIndex (0 to ${facts.length - 1}) and a text string
2. Do NOT repeat the same factIndex twice
3. Vary the clue types — pick a mix of direction, room, object, and population facts
4. Write "text" as an atmospheric in-world mystery clue (witness statement, investigation note, etc.)
5. The victim's position should be deducible from the clues, but don't state it trivially
6. The murderer's identity should emerge from logic, not be stated directly
7. Each suspect should be constrained by at least one clue

Example text style: "A witness reported seeing [name] near the fireplace in the library..." rather than stating facts bluntly.`,
  })

  trackUsage('Clue generation', usage)

  // Construct clues from pre-computed facts — LLM never touches constraint values
  return object.selections
    .filter(s => s.factIndex >= 0 && s.factIndex < facts.length)
    .filter((s, i, arr) => arr.findIndex(x => x.factIndex === s.factIndex) === i) // deduplicate
    .map(s => ({ ...facts[s.factIndex]!.clue, text: s.text }))
}

// ─── Text generation for a specific fact (programmatic fallback) ──────────────

export async function generateAdditionalClue(
  theme: PuzzleTheme,
  candidateFacts: DerivableFact[],
): Promise<Clue | null> {
  if (candidateFacts.length === 0) return null

  const fact = candidateFacts[0]!
  const { object, usage } = await generateObject({
    model,
    schema: z.object({ text: z.string() }),
    prompt: `Write one atmospheric mystery clue for this Murdoku puzzle.

Setting: ${theme.title} — ${theme.setting}
Fact to describe: ${fact.description}
Clue data: ${JSON.stringify(fact.clue)}

Write a single sentence of atmospheric mystery flavor text that conveys this fact.
Make it sound like a witness statement or investigation note. Do not be too on-the-nose.`,
  })

  trackUsage('Additional clue', usage)

  return { ...fact.clue, text: object.text } as Clue
}
