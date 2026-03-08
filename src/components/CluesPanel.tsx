import { useState } from 'react';
import { getCluePersonId } from '@shared/types';
import type { Person, StoredClue } from '@shared/types';
import { ClueItem } from './ClueItem';

interface CluesPanelProps {
  clues: StoredClue[];
  people: Person[];
  suspectSummaries: { personId: string; text: string }[];
  lockedPersonIds?: Set<string>;
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      style={{
        fontSize: 15,
        lineHeight: 1.4,
        flexShrink: 0,
        color: checked ? '#16a34a' : 'rgba(0,0,0,0.15)',
        fontWeight: 700,
      }}
    >
      ✓
    </span>
  );
}

function clueCardStyle(checked: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: 'flex',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    opacity: checked ? 0.45 : 1,
    cursor: 'pointer',
    userSelect: 'none',
    ...extra,
  };
}

export function CluesPanel({ clues, people, suspectSummaries, lockedPersonIds }: CluesPanelProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const victim = people.find((p) => p.role === 'victim')!;
  const summaryMap = new Map(suspectSummaries.map((s) => [s.personId, s.text]));
  const generalClues = clues.filter((c) => getCluePersonId(c) === null);

  const suspectSections = people
    .filter((p) => p.role === 'suspect')
    .map((p) => ({ person: p, summary: summaryMap.get(p.id) }))
    .filter((s): s is { person: Person; summary: string } => s.summary !== undefined);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '16px',
        background: '#fafaf8',
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.1)',
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 17,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'rgba(0,0,0,0.4)',
        }}
      >
        Evidence
      </h3>

      {/* Suspect sections — one summary sentence each */}
      {suspectSections.map(({ person, summary }) => {
        const key = `suspect-${person.id}`;
        const isChecked = (lockedPersonIds?.has(person.id) ?? false) || checked.has(key);
        return (
          <div key={person.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
                borderBottom: '1px solid rgba(0,0,0,0.08)',
              }}
            >
              <span style={{ fontSize: 19 }}>{person.avatarEmoji}</span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#334155',
                }}
              >
                {person.name}
              </span>
            </div>
            <div
              onClick={() => toggle(key)}
              style={clueCardStyle(isChecked, {
                background: 'rgba(0,0,0,0.03)',
                borderLeft: '3px solid rgba(0,0,0,0.12)',
              })}
            >
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#1a1a2e', flex: 1 }}>
                {summary}
              </p>
              <CheckMark checked={isChecked} />
            </div>
          </div>
        );
      })}

      {/* Victim section — always shown with fixed rule text */}
      {(() => {
        const isChecked = checked.has('victim');
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
                borderBottom: '1px solid rgba(0,0,0,0.08)',
              }}
            >
              <span style={{ fontSize: 19 }}>{victim.avatarEmoji}</span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#dc2626',
                }}
              >
                {victim.name}
              </span>
              <span style={{ fontSize: 13, color: 'rgba(220,38,38,0.6)', fontWeight: 600 }}>
                · victim
              </span>
            </div>
            <div
              onClick={() => toggle('victim')}
              style={clueCardStyle(isChecked, {
                background: 'rgba(220,38,38,0.05)',
                borderLeft: '3px solid rgba(220,38,38,0.25)',
              })}
            >
              <span style={{ fontSize: 19, lineHeight: 1.4, flexShrink: 0 }}>💀</span>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#1a1a2e', flex: 1 }}>
                The victim is alone in a room with the murderer.
              </p>
              <CheckMark checked={isChecked} />
            </div>
          </div>
        );
      })()}

      {/* General clues — shown individually */}
      {generalClues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              padding: '4px 0',
              borderBottom: '1px solid rgba(0,0,0,0.08)',
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'rgba(0,0,0,0.4)',
              }}
            >
              General
            </span>
          </div>
          {generalClues.map((clue, i) => (
            <ClueItem
              key={i}
              clue={clue}
              checked={checked.has(`general-${i}`)}
              onToggle={() => toggle(`general-${i}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
