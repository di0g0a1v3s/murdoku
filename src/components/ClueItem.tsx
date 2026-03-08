import type { Clue } from '@shared/types';

const CLUE_ICONS: Record<Clue['kind'], string> = {
  'person-direction': '🧭',
  'person-distance': '📏',
  'person-beside-object': '👁️',
  'person-on-object': '🪑',
  'person-in-room': '🚪',
  'persons-same-room': '👥',
  'person-alone-in-room': '🔇',
  'room-population': '🏠',
  'object-occupancy': '📦',
  'person-not-in-room': '🚫',
  'persons-not-same-room': '↔️',
  'person-in-room-with': '🫂',
  'person-in-row': '↕️',
  'person-in-col': '↔️',
  'person-in-corner': '📐',
  'person-in-room-corner': '📐',
  'person-sole-occupant': '🪑',
  'empty-rooms': '🏚️',
};

interface ClueItemProps {
  clue: Clue;
  checked?: boolean;
  onToggle?: () => void;
}

export function ClueItem({ clue, checked, onToggle }: ClueItemProps) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.03)',
        borderLeft: '3px solid rgba(0,0,0,0.12)',
        opacity: checked ? 0.45 : 1,
        cursor: onToggle ? 'pointer' : undefined,
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 19, lineHeight: 1.4, flexShrink: 0 }}>{CLUE_ICONS[clue.kind]}</span>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#1a1a2e', flex: 1 }}>
        {clue.text}
      </p>
      {onToggle && (
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
      )}
    </div>
  );
}
