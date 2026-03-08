import type { Person } from '@shared/types';

interface CellPopupProps {
  people: Person[];
  marks: Set<string>;
  committed: boolean;
  position: { x: number; y: number };
  onToggle: (mark: string) => void;
  onCommit: (personId: string) => void;
  onUncommit: () => void;
  onClose: () => void;
}

export function CellPopup({
  people,
  marks,
  committed,
  position,
  onToggle,
  onCommit,
  onUncommit,
  onClose,
}: CellPopupProps) {
  const personIds = [...marks].filter((m) => m !== 'X');
  const canCommit = personIds.length === 1 && !marks.has('X');

  const POPUP_W = 44 * Math.min(people.length + 1, 6) + 16;
  const POPUP_H = people.length + 1 > 6 ? 108 : 60;
  const POPUP_H_TOTAL = POPUP_H + 44;

  const left = Math.max(8, Math.min(position.x - POPUP_W / 2, window.innerWidth - POPUP_W - 8));
  const top =
    position.y + 12 + POPUP_H_TOTAL > window.innerHeight
      ? position.y - POPUP_H_TOTAL - 12
      : position.y + 12;

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={onClose} />
      {/* Popup */}
      <div
        style={{
          position: 'fixed',
          left,
          top,
          zIndex: 1000,
          background: 'white',
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.22)',
          border: '1px solid rgba(0,0,0,0.1)',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxWidth: 260,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...people]
            .sort((a, b) => (a.role === 'victim' ? 1 : 0) - (b.role === 'victim' ? 1 : 0))
            .map((person) => {
              const initial = person.name[0].toUpperCase();
              const active = marks.has(person.id);
              const isVictim = person.role === 'victim';
              const activeColor = isVictim ? '#dc2626' : '#7c3aed';
              return (
                <button
                  key={person.id}
                  onClick={() => onToggle(person.id)}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    border: '2px solid',
                    borderColor: active ? activeColor : 'rgba(0,0,0,0.15)',
                    background: active ? activeColor : 'white',
                    color: active ? 'white' : '#333',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                  title={person.name}
                >
                  {initial}
                </button>
              );
            })}
        </div>
        {/* Bottom row: X + Commit */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onToggle('X')}
            style={{
              flex: '0 0 auto',
              padding: '7px 14px',
              borderRadius: 8,
              border: '2px solid',
              borderColor: marks.has('X') ? '#dc2626' : '#dc2626',
              background: marks.has('X') ? '#dc2626' : 'white',
              color: marks.has('X') ? 'white' : '#dc2626',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Mark as empty"
          >
            ✕ Rule out
          </button>
          <button
            onClick={() => {
              if (committed) {
                onUncommit();
              } else if (canCommit) {
                onCommit(personIds[0]!);
              }
            }}
            disabled={!committed && !canCommit}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: 8,
              border: '2px solid',
              borderColor: committed ? '#16a34a' : canCommit ? '#16a34a' : 'rgba(0,0,0,0.1)',
              background: committed ? '#dcfce7' : canCommit ? '#16a34a' : 'rgba(0,0,0,0.04)',
              color: committed ? '#15803d' : canCommit ? 'white' : 'rgba(0,0,0,0.25)',
              fontSize: 13,
              fontWeight: 700,
              cursor: canCommit ? 'pointer' : 'default',
            }}
            title="Lock this suspect here"
          >
            {committed ? '✓ Locked' : 'Lock ✓'}
          </button>
        </div>
      </div>
    </>
  );
}
