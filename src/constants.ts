import type { PuzzleDifficulty } from '@shared/types';

// ─── localStorage keys ────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  completed: 'murdoku-completed',
  progressPrefix: 'murdoku-progress-',
  committedPrefix: 'murdoku-committed-',
} as const;

// ─── Difficulty colours ───────────────────────────────────────────────────────

export const DIFFICULTY_COLOR: Record<PuzzleDifficulty, string> = {
  easy: '#16a34a',
  medium: '#d97706',
  hard: '#dc2626',
  'very-hard': '#7f1d1d',
};
