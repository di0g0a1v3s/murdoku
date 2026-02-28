import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { Person, Room } from '../shared/types.js'
import { trackUsage } from './cost-tracker.js'

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? '',
})

const model = google('gemini-2.0-flash')

let debugMode = false
export function setDebug(enabled: boolean): void { debugMode = enabled }

function debugLog(label: string, prompt: string, result: unknown): void {
  if (!debugMode) return
  console.log('\n' + '─'.repeat(60))
  console.log(`[LLM DEBUG] ${label}`)
  console.log('─'.repeat(60))
  console.log('[PROMPT]\n' + prompt)
  console.log('\n[RESPONSE]\n' + JSON.stringify(result, null, 2))
  console.log('─'.repeat(60))
}

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
  })).length(6).describe('Exactly 6 people: index 0 is the VICTIM (name starts with V), index 1 is suspect A (name starts with A), index 2 is suspect B (name starts with B), index 3 is suspect C (name starts with C), index 4 is suspect D (name starts with D), index 5 is suspect E (name starts with E)'),
})

export interface PuzzleTheme {
  title: string
  subtitle: string
  setting: string
  people: Person[]
  rooms: Pick<Room, 'id' | 'name' | 'color'>[]
}

export async function generateTheme(): Promise<PuzzleTheme> {
  const prompt = `You are designing a murder mystery logic puzzle called Murdoku.
Create a unique and atmospheric theme for a 6-person puzzle set in an interesting location.

Requirements:
- Title should be dramatic and specific to the setting — avoid generic dark words like "Obsidian", "Shadow", "Blood", "Crimson", "Midnight", "Dark", "Black"
  Good examples: "Death on the Orient Express", "The Vanishing at Thornfield", "Poisoned at the Grand Prix", "A Fatal Evening at Café Lumière"
- Setting can be any interesting location (manor, ship, library, theatre, casino, monastery, etc.)
- Room names should fit the setting naturally
- Room colors should be distinct and evoke the mood (hex codes)
- 6 people with specific naming rules:
  - Person 0 (VICTIM): name must start with V (e.g. Victor, Vivienne, Valentina)
  - Person 1 (suspect A): name must start with A
  - Person 2 (suspect B): name must start with B
  - Person 3 (suspect C): name must start with C
  - Person 4 (suspect D): name must start with D
  - Person 5 (suspect E): name must start with E
- Names should be memorable and fit the setting's era/style
- Each person gets one emoji avatar

Make it creative and varied — avoid clichés.`

  const { object, usage } = await generateObject({ model, schema: ThemeSchema, prompt, temperature: 1.5 })

  trackUsage('Theme generation', usage)
  debugLog('generateTheme', prompt, object)

  const rooms = object.roomNames.map((name, i) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    color: object.roomColors[i]!,
  }))

  const REQUIRED_INITIALS = ['V', 'A', 'B', 'C', 'D', 'E']
  const FALLBACK_NAMES = ['Victor', 'Alex', 'Blake', 'Casey', 'Dana', 'Elliot']

  const people: Person[] = object.people.map((p, i) => {
    const required = REQUIRED_INITIALS[i]!
    const name = p.name.startsWith(required) ? p.name : FALLBACK_NAMES[i]!
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      role: i === 0 ? 'victim' : 'suspect',
      avatarEmoji: p.avatarEmoji,
    }
  })

  return {
    title: object.title,
    subtitle: object.subtitle,
    setting: object.setting,
    rooms,
    people,
  }
}

// ─── All clue texts in one call ───────────────────────────────────────────────

export interface SuspectInput {
  personId: string
  name: string
  factDescriptions: string[]
}

export interface GeneralClueInput {
  kind: string
  description: string
}

export async function generateAllTexts(
  suspects: SuspectInput[],
  generalClues: GeneralClueInput[],
): Promise<{ suspectTexts: { personId: string; text: string }[]; generalClueTexts: string[] }> {
  const suspectsBlock = suspects.map((s, i) =>
    `${i + 1}. ${s.name}:\n${s.factDescriptions.map((d, j) => `   ${j + 1}. ${d}`).join('\n')}`
  ).join('\n\n')

  const generalBlock = generalClues.length > 0
    ? `\nGeneral clues:\n${generalClues.map((g, i) => `${i + 1}. [${g.kind}] ${g.description}`).join('\n')}`
    : ''

  const prompt = `You are writing clue text for a Murdoku murder mystery logic puzzle.

For each suspect, write exactly ONE natural sentence covering ALL of their listed facts.
For each general clue, rewrite the description as a natural sentence.

Rules:
- Plain factual English — no mystery prose, no metaphors
- Natural word order: "alone in the Library" not "in the Library and alone"
- Use "sitting in a chair" not "occupying a chair"
- Keep suspect names and room/object names exactly as given

Suspects:
${suspectsBlock}${generalBlock}

Return exactly ${suspects.length} suspect entries and exactly ${generalClues.length} general clue entries, in the same order as given.`

  const schema = z.object({
    suspects: z.array(z.object({ text: z.string() })),
    generalClues: z.array(z.object({ text: z.string() })),
  })

  const { object, usage } = await generateObject({ model, schema, prompt, temperature: 0.4 })

  trackUsage('Clue texts', usage)
  debugLog('generateAllTexts', prompt, object)

  return {
    suspectTexts: suspects.map((s, i) => ({ personId: s.personId, text: object.suspects[i]!.text })),
    generalClueTexts: object.generalClues.map(g => g.text),
  }
}
