import { useState, useEffect } from 'react'
import type { Puzzle } from '@shared/types'
import { GridCanvas } from './GridCanvas'
import { CluesPanel } from './CluesPanel'
import { MurdererReveal } from './MurdererReveal'

interface PuzzleViewProps {
  puzzle: Puzzle
}

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return width
}

export function PuzzleView({ puzzle }: PuzzleViewProps) {
  const [showSolution, setShowSolution] = useState(false)
  const [showRevealModal, setShowRevealModal] = useState(false)
  const windowWidth = useWindowWidth()

  const isMobile = windowWidth < 640
  const availableWidth = Math.min(windowWidth - 32, isMobile ? windowWidth - 32 : 400)
  const cellSize = Math.floor(availableWidth / puzzle.gridSize.cols)

  const murderer = puzzle.people.find(p => p.id === puzzle.solution.murdererId)!
  const victim = puzzle.people.find(p => p.id === puzzle.solution.victimId)!
  const murderRoom = puzzle.rooms.find(r => r.id === puzzle.solution.murderRoom)

  function handleReveal() {
    setShowSolution(true)
    setShowRevealModal(true)
  }

  function handleHide() {
    setShowSolution(false)
    setShowRevealModal(false)
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      maxWidth: 900,
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        padding: '20px 16px 12px',
        width: '100%',
      }}>
        <h1 style={{
          margin: '0 0 4px 0',
          fontSize: isMobile ? 24 : 31,
          fontWeight: 800,
          color: '#1a1a2e',
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
        }}>
          {puzzle.title}
        </h1>
        {puzzle.subtitle && (
          <p style={{
            margin: '0 0 16px 0',
            fontSize: 17,
            color: 'rgba(0,0,0,0.45)',
            fontStyle: 'italic',
          }}>
            {puzzle.subtitle}
          </p>
        )}

        {/* Suspects list */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: 'center',
          marginBottom: 16,
        }}>
          {puzzle.people.map(person => (
            <div key={person.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 20,
              background: person.role === 'victim' ? '#fee2e2' : '#f1f5f9',
              border: `1px solid ${person.role === 'victim' ? '#fca5a5' : 'rgba(0,0,0,0.1)'}`,
              fontSize: 14,
              fontWeight: 600,
              color: person.role === 'victim' ? '#dc2626' : '#334155',
            }}>
              <span>{person.avatarEmoji}</span>
              <span>{person.name}</span>
              {person.role === 'victim' && <span style={{ opacity: 0.6 }}>· victim</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Main content area */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: 16,
        width: '100%',
        padding: '0 16px 24px',
        alignItems: isMobile ? 'center' : 'flex-start',
        boxSizing: 'border-box',
      }}>
        {/* Grid */}
        <div style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            border: '2px solid rgba(0,0,0,0.15)',
          }}>
            <GridCanvas
              puzzle={puzzle}
              showSolution={showSolution}
              cellSize={cellSize}
            />
          </div>

          {/* Legend */}
          <div style={{
            display: 'flex',
            gap: 16,
            fontSize: 13,
            color: 'rgba(0,0,0,0.45)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            <span>💀 Victim</span>
            <span>🔪 Murderer</span>
            <span>👤 Suspect</span>
          </div>

          {/* Reveal button */}
          {!showSolution ? (
            <button
              onClick={handleReveal}
              style={{
                padding: '10px 28px',
                background: '#7c3aed',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(124,58,237,0.4)',
              }}
            >
              Reveal Solution
            </button>
          ) : (
            <button
              onClick={handleHide}
              style={{
                padding: '10px 28px',
                background: 'transparent',
                color: '#7c3aed',
                border: '2px solid #7c3aed',
                borderRadius: 8,
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Hide Solution
            </button>
          )}
        </div>

        {/* Clues panel */}
        <div style={{
          flex: 1,
          minWidth: 0,
          width: isMobile ? '100%' : undefined,
          maxHeight: isMobile ? 'none' : cellSize * puzzle.gridSize.rows + 60,
        }}>
          <CluesPanel clues={puzzle.clues} people={puzzle.people} suspectSummaries={puzzle.suspectSummaries} />
        </div>
      </div>

      {/* Murder reveal modal */}
      {showRevealModal && (
        <MurdererReveal
          murderer={murderer}
          victim={victim}
          murderRoom={murderRoom}
          onClose={() => setShowRevealModal(false)}
        />
      )}
    </div>
  )
}
