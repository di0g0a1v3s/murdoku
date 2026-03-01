import { useState, useEffect, useMemo } from 'react'
import type { Puzzle } from '@shared/types'
import { GridCanvas } from './GridCanvas'
import { CluesPanel } from './CluesPanel'
import { MurdererReveal } from './MurdererReveal'
import { CellPopup } from './CellPopup'

interface PuzzleViewProps {
  puzzle: Puzzle
  isCompleted: boolean
  onComplete: () => void
  onReset: () => void
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

const PROGRESS_KEY = (id: string) => `murdoku-progress-${id}`

function loadMarks(puzzleId: string): Map<string, Set<string>> {
  try {
    const stored = localStorage.getItem(PROGRESS_KEY(puzzleId))
    if (!stored) return new Map()
    const parsed = JSON.parse(stored) as Record<string, string[]>
    return new Map(Object.entries(parsed).map(([k, v]) => [k, new Set(v)]))
  } catch {
    return new Map()
  }
}

export function PuzzleView({ puzzle, isCompleted, onComplete, onReset }: PuzzleViewProps) {
  const [showSolution, setShowSolution] = useState(false)
  const [showRevealModal, setShowRevealModal] = useState(false)
  // cellMarks: "row,col" → Set of personId | 'X'
  // Initialized from localStorage; component remounts when puzzle changes (key={puzzle.id} in App)
  const [cellMarks, setCellMarks] = useState<Map<string, Set<string>>>(() => loadMarks(puzzle.id))
  const [popup, setPopup] = useState<{ row: number; col: number; x: number; y: number } | null>(null)
  const [verifyResult, setVerifyResult] = useState<'correct' | 'wrong' | null>(
    isCompleted ? 'correct' : null
  )

  // Persist marks to localStorage whenever they change
  useEffect(() => {
    try {
      if (cellMarks.size === 0) {
        localStorage.removeItem(PROGRESS_KEY(puzzle.id))
      } else {
        const obj = Object.fromEntries([...cellMarks].map(([k, v]) => [k, [...v]]))
        localStorage.setItem(PROGRESS_KEY(puzzle.id), JSON.stringify(obj))
      }
    } catch { /* ignore quota/private-mode errors */ }
  }, [cellMarks, puzzle.id])

  const windowWidth = useWindowWidth()

  function handleCellClick(row: number, col: number, e: React.MouseEvent) {
    setPopup(prev =>
      prev?.row === row && prev?.col === col
        ? null
        : { row, col, x: e.clientX, y: e.clientY }
    )
  }

  function handleToggleMark(mark: string) {
    if (!popup) return
    const key = `${popup.row},${popup.col}`
    setCellMarks(prev => {
      const next = new Map(prev)
      const cell = new Set(prev.get(key) ?? [])
      if (mark === 'X') {
        if (cell.has('X')) { cell.delete('X') }
        else { cell.clear(); cell.add('X') }
      } else {
        if (cell.has(mark)) { cell.delete(mark) }
        else { cell.delete('X'); cell.add(mark) }
      }
      if (cell.size === 0) next.delete(key)
      else next.set(key, cell)
      return next
    })
    setVerifyResult(null)
    setPopup(null)
  }

  function handleVerify() {
    const { placements } = puzzle.solution

    // Collect all person marks from cellMarks (ignore X)
    const userPlacements: { personId: string; key: string }[] = []
    for (const [key, marks] of cellMarks) {
      const personIds = [...marks].filter(m => m !== 'X')
      if (personIds.length > 1) { setVerifyResult('wrong'); return }
      if (personIds.length === 1) userPlacements.push({ personId: personIds[0]!, key })
    }

    // Must have exactly one mark per solution placement, nothing extra
    if (userPlacements.length !== placements.length) { setVerifyResult('wrong'); return }

    for (const { personId, coord } of placements) {
      const key = `${coord.row},${coord.col}`
      if (!userPlacements.some(u => u.key === key && u.personId === personId)) {
        setVerifyResult('wrong'); return
      }
    }

    setVerifyResult('correct')
    onComplete()
  }

  function handleReset() {
    setCellMarks(new Map())
    setVerifyResult(null)
    onReset()
  }

  const isMobile = windowWidth < 640
  const availableWidth = Math.min(windowWidth - 32, isMobile ? windowWidth - 32 : 400)
  const cellSize = Math.floor(availableWidth / puzzle.gridSize.cols)

  const solutionMarks = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of puzzle.solution.placements) {
      m.set(`${p.coord.row},${p.coord.col}`, new Set([p.personId]))
    }
    return m
  }, [puzzle.solution.placements])

  const effectiveMarks = showSolution ? solutionMarks : cellMarks

  const murderer = puzzle.people.find(p => p.id === puzzle.solution.murdererId)!
  const victim = puzzle.people.find(p => p.id === puzzle.solution.victimId)!
  const murderRoom = puzzle.rooms.find(r => r.id === puzzle.solution.murderRoom)

  function handleReveal() {
    setShowSolution(true)
    setShowRevealModal(true)
    setPopup(null)
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
            border: verifyResult === 'correct'
              ? '2px solid #16a34a'
              : verifyResult === 'wrong'
                ? '2px solid #dc2626'
                : '2px solid rgba(0,0,0,0.15)',
          }}>
            <GridCanvas
              puzzle={puzzle}
              cellSize={cellSize}
              cellMarks={effectiveMarks}
              onCellClick={showSolution ? undefined : handleCellClick}
            />
          </div>

          {/* Verify / result */}
          {!showSolution && (
            verifyResult === 'correct' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  padding: '8px 20px',
                  background: '#dcfce7',
                  color: '#15803d',
                  borderRadius: 8,
                  fontSize: 15,
                  fontWeight: 700,
                  border: '1px solid #86efac',
                }}>
                  ✓ Correct! Case closed.
                </div>
                <button
                  onClick={handleReset}
                  style={{
                    padding: '8px 14px',
                    background: 'transparent',
                    color: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(0,0,0,0.15)',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="Reset puzzle"
                >
                  Reset
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={handleVerify}
                  style={{
                    padding: '10px 28px',
                    background: '#1a1a2e',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 17,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  }}
                >
                  Verify Solution
                </button>
                {verifyResult === 'wrong' && (
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#dc2626',
                  }}>
                    Not quite. Keep investigating.
                  </div>
                )}
              </div>
            )
          )}

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

      {/* Cell mark popup */}
      {popup && (
        <CellPopup
          people={puzzle.people}
          marks={cellMarks.get(`${popup.row},${popup.col}`) ?? new Set()}
          position={{ x: popup.x, y: popup.y }}
          onToggle={handleToggleMark}
          onClose={() => setPopup(null)}
        />
      )}

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
