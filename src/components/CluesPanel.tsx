import type { Clue, Person } from '@shared/types'
import { ClueItem } from './ClueItem'

interface CluesPanelProps {
  clues: Clue[]
  people: Person[]
  suspectSummaries: { personId: string; text: string }[]
}

function getPrimaryPersonId(clue: Clue): string | null {
  switch (clue.kind) {
    case 'person-direction':
    case 'person-distance':
    case 'persons-same-room':
    case 'persons-not-same-room':
      return clue.personA
    case 'person-beside-object':
    case 'person-on-object':
    case 'person-in-room':
    case 'person-alone-in-room':
    case 'person-not-in-room':
      return clue.person
    case 'room-population':
    case 'object-occupancy':
      return null
  }
}

export function CluesPanel({ clues, people, suspectSummaries }: CluesPanelProps) {
  const victim = people.find(p => p.role === 'victim')!
  const summaryMap = new Map(suspectSummaries.map(s => [s.personId, s.text]))
  const generalClues = clues.filter(c => getPrimaryPersonId(c) === null)

  const suspectSections = people
    .filter(p => p.role === 'suspect')
    .map(p => ({ person: p, summary: summaryMap.get(p.id) }))
    .filter((s): s is { person: Person; summary: string } => s.summary !== undefined)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: '16px',
      background: '#fafaf8',
      borderRadius: 12,
      border: '1px solid rgba(0,0,0,0.1)',
      height: '100%',
      overflowY: 'auto',
    }}>
      <h3 style={{
        margin: 0,
        fontSize: 17,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'rgba(0,0,0,0.4)',
      }}>
        Evidence
      </h3>

      {/* Victim section — always shown with fixed rule text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 0',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}>
          <span style={{ fontSize: 19 }}>{victim.avatarEmoji}</span>
          <span style={{
            fontSize: 14,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#dc2626',
          }}>
            {victim.name}
          </span>
          <span style={{ fontSize: 13, color: 'rgba(220,38,38,0.6)', fontWeight: 600 }}>· victim</span>
        </div>
        <div style={{
          display: 'flex',
          gap: 10,
          padding: '8px 10px',
          borderRadius: 8,
          background: 'rgba(220,38,38,0.05)',
          borderLeft: '3px solid rgba(220,38,38,0.25)',
        }}>
          <span style={{ fontSize: 19, lineHeight: 1.4, flexShrink: 0 }}>💀</span>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#1a1a2e' }}>
            The victim is alone in a room with the murderer.
          </p>
        </div>
      </div>

      {/* Suspect sections — one summary sentence each */}
      {suspectSections.map(({ person, summary }) => (
        <div key={person.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 0',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
          }}>
            <span style={{ fontSize: 19 }}>{person.avatarEmoji}</span>
            <span style={{
              fontSize: 14,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#334155',
            }}>
              {person.name}
            </span>
          </div>
          <div style={{
            display: 'flex',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.03)',
            borderLeft: '3px solid rgba(0,0,0,0.12)',
          }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#1a1a2e' }}>
              {summary}
            </p>
          </div>
        </div>
      ))}

      {/* General clues — shown individually */}
      {generalClues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            padding: '4px 0',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
          }}>
            <span style={{
              fontSize: 14,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'rgba(0,0,0,0.4)',
            }}>
              General
            </span>
          </div>
          {generalClues.map((clue, i) => (
            <ClueItem key={i} clue={clue} />
          ))}
        </div>
      )}
    </div>
  )
}
