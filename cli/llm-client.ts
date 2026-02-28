import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { Clue, Person, Room } from '../shared/types.js'

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
  const { object } = await generateObject({
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

const ClueOutputSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person-direction'), personA: z.string(), direction: z.enum(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']), personB: z.string(), text: z.string() }),
  z.object({ kind: z.literal('person-distance'), personA: z.string(), direction: z.enum(['N', 'S', 'E', 'W']), personB: z.string(), distance: z.number().int().positive(), axis: z.enum(['row', 'col']), text: z.string() }),
  z.object({ kind: z.literal('person-beside-object'), person: z.string(), objectKind: z.string(), text: z.string() }),
  z.object({ kind: z.literal('person-on-object'), person: z.string(), objectKind: z.string(), text: z.string() }),
  z.object({ kind: z.literal('person-in-room'), person: z.string(), roomId: z.string(), text: z.string() }),
  z.object({ kind: z.literal('persons-same-room'), personA: z.string(), personB: z.string(), text: z.string() }),
  z.object({ kind: z.literal('person-alone-in-room'), person: z.string(), text: z.string() }),
  z.object({ kind: z.literal('room-population'), roomId: z.string(), count: z.number().int().positive(), text: z.string() }),
  z.object({ kind: z.literal('object-occupancy'), objectKind: z.string(), count: z.number().int().min(0), text: z.string() }),
  z.object({ kind: z.literal('person-not-in-room'), person: z.string(), roomId: z.string(), text: z.string() }),
  z.object({ kind: z.literal('persons-not-same-room'), personA: z.string(), personB: z.string(), text: z.string() }),
]))

export interface DerivableFact {
  description: string
  clue: Clue
}

export async function generateClues(
  theme: PuzzleTheme,
  facts: DerivableFact[],
  targetCount: number = 10,
): Promise<Clue[]> {
  const factsText = facts.map((f, i) => `${i + 1}. ${f.description}`).join('\n')
  const factsJson = JSON.stringify(facts.map(f => f.clue), null, 2)

  const { object } = await generateObject({
    model,
    schema: z.object({ clues: ClueOutputSchema }),
    prompt: `You are writing clues for a Murdoku puzzle (murder mystery + logic grid).

SETTING: ${theme.title}
${theme.setting}

PUZZLE SOLUTION FACTS (these are ALL the true statements about this puzzle):
${factsText}

CORRESPONDING CLUE OBJECTS (use these exact values when writing clues):
${factsJson}

TASK: Select exactly ${targetCount} clues from the facts above that, together, uniquely identify where every person is located.

Rules:
1. Each clue must use EXACT values from the clue objects above (same personA/personB/roomId/etc.)
2. Write atmospheric, story-flavored "text" for each clue that fits the setting: "${theme.setting}"
3. Vary the clue types — don't use the same kind repeatedly
4. The victim's position should be deducible, but NOT state it trivially (e.g., don't directly say "victim is in Room X")
5. The murderer's identity should emerge from logic, not be stated
6. Each suspect should be constrained by at least one clue
7. Return exactly ${targetCount} clues

The "text" field is the human-readable mystery flavor text shown to the player. Make it atmospheric and in-world (e.g., "A witness reported seeing [name] near the fireplace in the library..." rather than just stating facts bluntly).`,
  })

  return object.clues as Clue[]
}

// ─── Minimal extra clues (programmatic fallback) ──────────────────────────────

export async function generateAdditionalClue(
  theme: PuzzleTheme,
  facts: DerivableFact[],
  existingClues: Clue[],
): Promise<Clue | null> {
  const existingDescriptions = new Set(existingClues.map(c => JSON.stringify(c)))
  const unusedFacts = facts.filter(f => !existingDescriptions.has(JSON.stringify(f.clue)))
  if (unusedFacts.length === 0) return null

  const fact = unusedFacts[0]!
  const { object } = await generateObject({
    model,
    schema: z.object({ text: z.string() }),
    prompt: `Write one atmospheric mystery clue for this Murdoku puzzle.

Setting: ${theme.title} — ${theme.setting}
Fact to describe: ${fact.description}
Clue data: ${JSON.stringify(fact.clue)}

Write a single sentence of atmospheric mystery flavor text that conveys this fact.
Make it sound like a witness statement or investigation note. Do not be too on-the-nose.`,
  })

  return { ...fact.clue, text: object.text } as Clue
}
