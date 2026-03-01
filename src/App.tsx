import { useState } from 'react'
import type { PuzzleCollection } from '@shared/types'
import puzzleData from './puzzles/puzzles.json'
import { PuzzleView } from './components/PuzzleView'
import { PuzzleSelector } from './components/PuzzleSelector'

const collection = puzzleData as PuzzleCollection

export function App() {
  const puzzles = collection.puzzles
  const [selectedId, setSelectedId] = useState(puzzles[0]?.id ?? '')
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('murdoku-completed')
      return new Set(stored ? JSON.parse(stored) as string[] : [])
    } catch {
      return new Set()
    }
  })

  function handleComplete(id: string) {
    setCompletedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem('murdoku-completed', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  function handleReset(id: string) {
    setCompletedIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      try { localStorage.setItem('murdoku-completed', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
    try { localStorage.removeItem(`murdoku-progress-${id}`) } catch { /* ignore */ }
  }

  const selectedPuzzle = puzzles.find(p => p.id === selectedId) ?? puzzles[0]

  if (puzzles.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#1a1a2e',
        flexDirection: 'column',
        gap: 16,
        padding: 32,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48 }}>🕵️</div>
        <h1 style={{ margin: 0, fontSize: 33, fontWeight: 800 }}>Murdoku</h1>
        <p style={{ margin: 0, color: 'rgba(0,0,0,0.5)', fontSize: 19 }}>
          No puzzles yet. Run{' '}
          <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
            npm run generate
          </code>{' '}
          to create one.
        </p>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8f6f0',
      color: '#1a1a2e',
    }}>
      {/* Top bar */}
      <div style={{
        background: '#1a1a2e',
        color: 'white',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ fontSize: 26 }}>🕵️</span>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>Murdoku</span>
        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', marginLeft: 4 }}>
          Murder Mystery Logic Puzzles
        </span>
      </div>

      <PuzzleSelector
        puzzles={puzzles}
        selectedId={selectedId}
        onSelect={setSelectedId}
        completedIds={completedIds}
      />

      {selectedPuzzle && (
        <PuzzleView
          key={selectedPuzzle.id}
          puzzle={selectedPuzzle}
          isCompleted={completedIds.has(selectedPuzzle.id)}
          onComplete={() => handleComplete(selectedPuzzle.id)}
          onReset={() => handleReset(selectedPuzzle.id)}
        />
      )}
    </div>
  )
}

export default App
