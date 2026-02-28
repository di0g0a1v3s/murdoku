import type { Person, Room } from '@shared/types'

interface MurdererRevealProps {
  murderer: Person
  victim: Person
  murderRoom: Room | undefined
  onClose: () => void
}

export function MurdererReveal({ murderer, victim, murderRoom, onClose }: MurdererRevealProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1a2e',
          borderRadius: 16,
          padding: '32px 28px',
          maxWidth: 360,
          width: '100%',
          textAlign: 'center',
          color: 'white',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 48, marginBottom: 8 }}>🔪</div>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>
          Case Solved!
        </h2>
        <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          The investigation is complete
        </p>

        <div style={{
          background: 'rgba(255,255,255,0.07)',
          borderRadius: 10,
          padding: '16px',
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 36, marginBottom: 6 }}>{murderer.avatarEmoji ?? '👤'}</div>
          <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            The murderer
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 800 }}>
            {murderer.name}
          </p>
          {murderRoom && (
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
              committed the crime in the {murderRoom.name}
            </p>
          )}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'center',
          fontSize: 13,
          color: 'rgba(255,255,255,0.45)',
          marginBottom: 24,
        }}>
          <span>{victim.avatarEmoji ?? '💀'}</span>
          <span>Victim: {victim.name}</span>
        </div>

        <button
          onClick={onClose}
          style={{
            background: '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            padding: '10px 24px',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}
