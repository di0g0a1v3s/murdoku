import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import { OBJECT_KIND_VALUES } from '../shared/types.js';
import type { ObjectKind, Person, Room, RoomPattern } from '../shared/types.js';
import { trackUsage } from './cost-tracker.js';

const google = createGoogleGenerativeAI({
	apiKey: process.env.GEMINI_API_KEY ?? '',
});

const model = google('gemini-2.0-flash');

let debugMode = false;
export function setDebug(enabled: boolean): void {
	debugMode = enabled;
}

function debugLog(label: string, prompt: string, result: unknown): void {
	if (!debugMode) {
		return;
	}
	console.log('\n' + '─'.repeat(60));
	console.log(`[LLM DEBUG] ${label}`);
	console.log('─'.repeat(60));
	console.log('[PROMPT]\n' + prompt);
	console.log('\n[RESPONSE]\n' + JSON.stringify(result, null, 2));
	console.log('─'.repeat(60));
}

// ─── Theme Generation ─────────────────────────────────────────────────────────

const FALLBACK_NAMES: Record<string, string> = {
	V: 'Victor',
	A: 'Alex',
	B: 'Blake',
	C: 'Casey',
	D: 'Dana',
	E: 'Elliot',
	F: 'Frances',
	G: 'George',
	H: 'Henry',
	I: 'Iris',
	J: 'James',
	K: 'Kit',
};

export interface PuzzleTheme {
	title: string;
	subtitle: string;
	setting: string;
	people: Person[];
	rooms: (Pick<Room, 'id' | 'name' | 'pattern'> & {
		allowedObjects: ObjectKind[];
		requiredObjects: ObjectKind[];
		sizePercentage: number;
	})[];
}

export async function generateTheme(
	n: number,
	existingTitles: string[] = [],
): Promise<PuzzleTheme> {
	const suspectInitials = Array.from({ length: n - 1 }, (_, i) => String.fromCharCode(65 + i));
	const allInitials = ['V', ...suspectInitials];

	const schema = z.object({
		title: z
			.string()
			.describe(
				'A 1–3 word title referring to the place or time of the crime (e.g. "The Hotel", "The Mall", "Valentine\'s Day", "The Orient Express")',
			),
		subtitle: z.string().describe('A short atmospheric tagline'),
		setting: z.string().describe('Brief description of the setting/atmosphere'),
		rooms: z
			.array(
				z.object({
					name: z.string().describe('Room name, at most 2 words'),
					patternKind: z
						.enum(['solid', 'striped', 'checkered'])
						.describe(
							'Visual pattern: solid (single color), striped (alternating rows), checkered (alternating cells). Use striped or checkered for variety.',
						),
					colorA: z.string().describe('Primary hex color (e.g. #F5E6D3) — muted and atmospheric'),
					colorB: z
						.string()
						.describe(
							'Secondary hex color for striped/checkered; for solid rooms use the same value as colorA',
						),
					sizePercentage: z
						.number()
						.int()
						.min(5)
						.max(60)
						.describe(
							'Relative size of this room as a percentage of the total grid area. All rooms should sum to roughly 100.',
						),
					allowedObjects: z
						.array(z.enum(OBJECT_KIND_VALUES))
						.describe(
							`2–5 object kinds that could realistically appear in this room. Choose from: ${OBJECT_KIND_VALUES.join(', ')}`,
						),
					requiredObjects: z
						.array(z.enum(OBJECT_KIND_VALUES))
						.max(2)
						.describe(
							'0–2 objects that must appear in this room (must be a subset of allowedObjects). Use for objects that are definitionally part of the room, e.g. a toilet in a bathroom, a bed in a bedroom, a counter in a bar.',
						),
				}),
			)
			.describe('Rooms — names at most 2 words, colors distinct'),
		people: z
			.array(
				z.object({
					name: z.string(),
					avatarEmoji: z.string().describe('A single emoji representing this person'),
				}),
			)
			.length(n)
			.describe(
				`Exactly ${n} people: index 0 is the VICTIM (name starts with V), ` +
					suspectInitials
						.map((l, i) => `index ${i + 1} is suspect ${l} (name starts with ${l})`)
						.join(', '),
			),
	});

	const avoidLine =
		existingTitles.length > 0
			? `\n- Avoid these already-used titles: ${existingTitles.map((t) => `"${t}"`).join(', ')}`
			: '';

	const peopleRules = allInitials
		.map((letter, i) =>
			i === 0
				? `  - Person 0 (VICTIM): name must start with V (e.g. Victor, Vivienne, Valentina)`
				: `  - Person ${i} (suspect ${letter}): name must start with ${letter}`,
		)
		.join('\n');

	const prompt = `You are designing a murder mystery logic puzzle called Murdoku.
Create a unique and atmospheric theme for a ${n}-person puzzle set in an interesting location.

Requirements:
- Title must be 1–3 words referring to the place or time of the crime
  Good examples: "The Hotel", "The Mall", "Valentine's Day", "The Orient Express", "The Grand Prix", "The Monastery", "New Year's Eve"
  Avoid generic dark words like "Shadow", "Blood", "Crimson", "Midnight", "Dark"${avoidLine}
- Setting can be any interesting location (manor, ship, library, theatre, casino, monastery, etc.)
- Room names must be at most 2 words and fit the setting naturally
  Good examples: "Wine Cellar", "Ballroom", "Ship Deck", "Reading Room", "Boiler Room"
  Avoid directional/positional names like "East Wing", "North Hall", "West Room"
- For each room, provide a sizePercentage (integer, all rooms sum to ~100) reflecting how large the room should be relative to the total floor plan. Small rooms (bathroom, closet): 5–10. Medium rooms (bedroom, office): 15–20. Large rooms (ballroom, hall): 25–40.
- For each room, provide:
  - allowedObjects: 2–5 object kinds that could realistically appear there
  - requiredObjects: 0–2 objects that are definitionally part of the room (subset of allowedObjects)
  Available objects: ${OBJECT_KIND_VALUES.join(', ')}
  Examples:
    Bedroom   → allowed: [bed, wardrobe, chair, plant], required: [bed]
    Bathroom  → allowed: [toilet, wardrobe], required: [toilet]
    Bar       → allowed: [counter, sofa, chair, table], required: [counter]
    Library   → allowed: [bookshelf, chair, table, plant], required: [bookshelf]
    Ballroom  → allowed: [chair, sofa, plant, fireplace], required: []
- Room patterns: choose patternKind (solid/striped/checkered) and two colors (colorA, colorB). For solid rooms colorB equals colorA. Use striped or checkered for roughly half the rooms to add visual variety. Colors should be distinct across rooms and evoke the mood (muted hex codes)
- ${n} people with specific naming rules:
${peopleRules}
- Names should be memorable and fit the setting's era/style
- Each person gets one emoji avatar

Make it creative and varied — avoid clichés.`;

	const { object, usage } = await generateObject({ model, schema, prompt, temperature: 1.5 });

	trackUsage('Theme generation', usage);
	debugLog('generateTheme', prompt, object);

	const rooms = object.rooms.map((r) => {
		const pattern: RoomPattern =
			r.patternKind === 'solid'
				? { kind: 'solid', color: r.colorA }
				: r.patternKind === 'striped'
					? { kind: 'striped', colorA: r.colorA, colorB: r.colorB }
					: { kind: 'checkered', colorA: r.colorA, colorB: r.colorB };
		return {
			id: r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
			name: r.name,
			pattern,
			sizePercentage: r.sizePercentage,
			allowedObjects: r.allowedObjects as ObjectKind[],
			requiredObjects: r.requiredObjects as ObjectKind[],
		};
	});

	const people: Person[] = object.people.map((p, i) => {
		const initial = allInitials[i]!;
		const name = p.name.startsWith(initial) ? p.name : (FALLBACK_NAMES[initial] ?? initial);
		return {
			id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
			name,
			role: i === 0 ? 'victim' : 'suspect',
			avatarEmoji: p.avatarEmoji,
		};
	});

	return {
		title: object.title,
		subtitle: object.subtitle,
		setting: object.setting,
		rooms,
		people,
	};
}

// ─── All clue texts in one call ───────────────────────────────────────────────

export interface SuspectInput {
	personId: string;
	name: string;
	factDescriptions: string[];
}

export interface GeneralClueInput {
	kind: string;
	description: string;
}

export async function generateAllTexts(
	suspects: SuspectInput[],
	generalClues: GeneralClueInput[],
): Promise<{ suspectTexts: { personId: string; text: string }[]; generalClueTexts: string[] }> {
	const suspectsBlock = suspects
		.map(
			(s, i) =>
				`${i + 1}. ${s.name}:\n${s.factDescriptions.map((d, j) => `   ${j + 1}. ${d}`).join('\n')}`,
		)
		.join('\n\n');

	const generalBlock =
		generalClues.length > 0
			? `\nGeneral clues:\n${generalClues.map((g, i) => `${i + 1}. [${g.kind}] ${g.description}`).join('\n')}`
			: '';

	const prompt = `You are writing clue text for a Murdoku murder mystery logic puzzle.

For each suspect, write exactly ONE natural sentence covering ALL of their listed facts.
For each general clue, rewrite the description as a natural sentence.

Rules:
- Plain factual English — no mystery prose, no metaphors
- Natural word order: "alone in the Library" not "in the Library and alone"
- When combining "alone in a room" with other facts, join with "and": "Anya is alone in the Server Room and south of Chen Wei" — never use a comma clause like "Anya, alone in the Server Room, is south of Chen Wei"
- "in a room with 0 other people" means alone — write "alone in a room", not "in a room with exactly 0 other people"
- Row/column numbers use ordinals: "in the 3rd row" / "in the 4th column", not "in row 3" / "in column 4"
- Use "sitting in a chair" not "occupying a chair"
- Keep suspect names and room/object names exactly as given

Suspects:
${suspectsBlock}${generalBlock}

Return exactly ${suspects.length} suspect entries and exactly ${generalClues.length} general clue entries, in the same order as given.`;

	const schema = z.object({
		suspects: z.array(z.object({ text: z.string() })),
		generalClues: z.array(z.object({ text: z.string() })),
	});

	const { object, usage } = await generateObject({ model, schema, prompt, temperature: 0.4 });

	trackUsage('Clue texts', usage);
	debugLog('generateAllTexts', prompt, object);

	return {
		suspectTexts: suspects.map((s, i) => ({
			personId: s.personId,
			text: object.suspects[i]!.text,
		})),
		generalClueTexts: object.generalClues.map((g) => g.text),
	};
}
