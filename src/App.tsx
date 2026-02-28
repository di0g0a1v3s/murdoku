import { useState } from 'react'
import type { PuzzleCollection } from '@shared/types'
import puzzleData from './puzzles/puzzles.json'
import { PuzzleView } from './components/PuzzleView'
import { PuzzleSelector } from './components/PuzzleSelector'

const collection = puzzleData as PuzzleCollection

export function App() {
  const puzzles = collection.puzzles
  const [selectedId, setSelectedId] = useState(puzzles[0]?.id ?? '')

  const selectedPuzzle = puzzles.find(p => p.id === selectedId) ?? puzzles[0]

  if (puzzles.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Georgia, serif',
        color: '#1a1a2e',
        flexDirection: 'column',
        gap: 16,
        padding: 32,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48 }}>🕵️</div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Murdoku</h1>
        <p style={{ margin: 0, color: 'rgba(0,0,0,0.5)', fontSize: 16 }}>
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
      fontFamily: 'Georgia, "Times New Roman", serif',
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
        <span style={{ fontSize: 22 }}>🕵️</span>
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>Murdoku</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', marginLeft: 4 }}>
          Murder Mystery Logic Puzzles
        </span>
      </div>

      <PuzzleSelector
        puzzles={puzzles}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {selectedPuzzle && <PuzzleView key={selectedPuzzle.id} puzzle={selectedPuzzle} />}
    </div>
  )
}

export default App
