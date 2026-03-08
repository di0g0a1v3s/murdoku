import { useState, useEffect, useMemo } from 'react';
import type { Puzzle } from '@shared/types';
import { GridCanvas } from './GridCanvas';
import { CluesPanel } from './CluesPanel';
import { MurdererReveal } from './MurdererReveal';
import { CellPopup } from './CellPopup';

type UndoEntry = { marks: Map<string, Set<string>>; committed: Map<string, string> };

interface PuzzleViewProps {
	puzzle: Puzzle;
	isCompleted: boolean;
	undoStack: UndoEntry[];
	onUndoStackChange: (stack: UndoEntry[]) => void;
	onComplete: () => void;
	onReset: () => void;
}

function useWindowWidth() {
	const [width, setWidth] = useState(window.innerWidth);
	useEffect(() => {
		const handler = () => setWidth(window.innerWidth);
		window.addEventListener('resize', handler);
		return () => window.removeEventListener('resize', handler);
	}, []);
	return width;
}

const PROGRESS_KEY = (id: string) => `murdoku-progress-${id}`;
const COMMITTED_KEY = (id: string) => `murdoku-committed-${id}`;

function loadMarks(puzzleId: string): Map<string, Set<string>> {
	try {
		const stored = localStorage.getItem(PROGRESS_KEY(puzzleId));
		if (!stored) {
			return new Map();
		}
		const parsed = JSON.parse(stored) as Record<string, string[]>;
		return new Map(Object.entries(parsed).map(([k, v]) => [k, new Set(v)]));
	} catch {
		return new Map();
	}
}

function loadCommitted(puzzleId: string): Map<string, string> {
	try {
		const stored = localStorage.getItem(COMMITTED_KEY(puzzleId));
		if (!stored) {
			return new Map();
		}
		const parsed = JSON.parse(stored) as Record<string, string>;
		return new Map(Object.entries(parsed));
	} catch {
		return new Map();
	}
}

export function PuzzleView({
	puzzle,
	isCompleted,
	undoStack,
	onUndoStackChange,
	onComplete,
	onReset,
}: PuzzleViewProps) {
	const [showSolution, setShowSolution] = useState(false);
	const [showRevealModal, setShowRevealModal] = useState(false);
	const [howToPlayOpen, setHowToPlayOpen] = useState(false);
	// cellMarks: "row,col" → Set of personId | 'X'
	// Initialized from localStorage; component remounts when puzzle changes (key={puzzle.id} in App)
	const [cellMarks, setCellMarks] = useState<Map<string, Set<string>>>(() => loadMarks(puzzle.id));
	const [committedCells, setCommittedCells] = useState<Map<string, string>>(() =>
		loadCommitted(puzzle.id),
	);
	const [popup, setPopup] = useState<{ row: number; col: number; x: number; y: number } | null>(
		null,
	);
	const [verifyResult, setVerifyResult] = useState<'correct' | 'wrong' | null>(
		isCompleted ? 'correct' : null,
	);

	const nonOccupiable = useMemo(() => {
		const s = new Set<string>();
		for (const obj of puzzle.objects) {
			if (obj.occupiable === 'non-occupiable') {
				for (const c of obj.cells) {
					s.add(`${c.row},${c.col}`);
				}
			}
		}
		return s;
	}, [puzzle.objects]);

	// Persist marks to localStorage whenever they change
	useEffect(() => {
		try {
			if (cellMarks.size === 0) {
				localStorage.removeItem(PROGRESS_KEY(puzzle.id));
			} else {
				const obj = Object.fromEntries([...cellMarks].map(([k, v]) => [k, [...v]]));
				localStorage.setItem(PROGRESS_KEY(puzzle.id), JSON.stringify(obj));
			}
		} catch {
			/* ignore quota/private-mode errors */
		}
	}, [cellMarks, puzzle.id]);

	// Persist committed cells to localStorage
	useEffect(() => {
		try {
			if (committedCells.size === 0) {
				localStorage.removeItem(COMMITTED_KEY(puzzle.id));
			} else {
				const obj = Object.fromEntries(committedCells);
				localStorage.setItem(COMMITTED_KEY(puzzle.id), JSON.stringify(obj));
			}
		} catch {
			/* ignore */
		}
	}, [committedCells, puzzle.id]);

	const windowWidth = useWindowWidth();

	function handleCellClick(row: number, col: number, e: React.MouseEvent) {
		setPopup((prev) =>
			prev?.row === row && prev?.col === col ? null : { row, col, x: e.clientX, y: e.clientY },
		);
	}

	function handleToggleMark(mark: string) {
		if (!popup) {
			return;
		}
		const key = `${popup.row},${popup.col}`;
		onUndoStackChange([...undoStack, { marks: cellMarks, committed: committedCells }]);
		setCellMarks((prev) => {
			const next = new Map(prev);
			const cell = new Set(prev.get(key) ?? []);
			if (mark === 'X') {
				if (cell.has('X')) {
					cell.delete('X');
				} else {
					cell.clear();
					cell.add('X');
				}
			} else {
				if (cell.has(mark)) {
					cell.delete(mark);
				} else {
					cell.delete('X');
					cell.add(mark);
				}
			}
			if (cell.size === 0) {
				next.delete(key);
			} else {
				next.set(key, cell);
			}
			return next;
		});
		// Toggling a mark un-commits the cell
		setCommittedCells((prev) => {
			if (!prev.has(key)) {
				return prev;
			}
			const next = new Map(prev);
			next.delete(key);
			return next;
		});
		setVerifyResult(null);
		setPopup(null);
	}

	function handleUncommit(row: number, col: number) {
		const key = `${row},${col}`;
		onUndoStackChange([...undoStack, { marks: cellMarks, committed: committedCells }]);
		setCommittedCells((prev) => {
			const next = new Map(prev);
			next.delete(key);
			return next;
		});
		setVerifyResult(null);
		setPopup(null);
	}

	function handleCommit(row: number, col: number, personId: string) {
		const key = `${row},${col}`;
		onUndoStackChange([...undoStack, { marks: cellMarks, committed: committedCells }]);

		// Remove personId from all other cells; set this cell to exactly {personId}
		const newMarks = new Map(cellMarks);
		for (const [k, marks] of newMarks) {
			if (k === key) {
				continue;
			}
			if (marks.has(personId)) {
				const newSet = new Set(marks);
				newSet.delete(personId);
				if (newSet.size === 0) {
					newMarks.delete(k);
				} else {
					newMarks.set(k, newSet);
				}
			}
		}
		newMarks.set(key, new Set([personId]));

		// Commit this cell
		const newCommitted = new Map(committedCells);
		newCommitted.set(key, personId);

		// Cross out all other occupiable cells in the same row or column that aren't committed
		for (let r = 0; r < puzzle.gridSize.rows; r++) {
			for (let c = 0; c < puzzle.gridSize.cols; c++) {
				const k = `${r},${c}`;
				if (k === key) {
					continue;
				}
				if (r !== row && c !== col) {
					continue;
				}
				if (newCommitted.has(k)) {
					continue;
				}
				if (nonOccupiable.has(k)) {
					continue;
				}
				newMarks.set(k, new Set(['X']));
			}
		}

		setCellMarks(newMarks);
		setCommittedCells(newCommitted);
		setPopup(null);
		setVerifyResult(null);

		// Auto-verify when all people are committed
		if (newCommitted.size === puzzle.people.length) {
			const { placements } = puzzle.solution;
			const correct = placements.every(
				({ personId: pid, coord }) => newCommitted.get(`${coord.row},${coord.col}`) === pid,
			);
			if (correct) {
				setVerifyResult('correct');
				onComplete();
			} else {
				setVerifyResult('wrong');
			}
		}
	}

	function handleVerify() {
		const { placements } = puzzle.solution;
		const userPlacements: { personId: string; key: string }[] = [];
		for (const [key, marks] of cellMarks) {
			const personIds = [...marks].filter((m) => m !== 'X');
			if (personIds.length > 1) {
				setVerifyResult('wrong');
				return;
			}
			if (personIds.length === 1) {
				userPlacements.push({ personId: personIds[0]!, key });
			}
		}
		if (userPlacements.length !== placements.length) {
			setVerifyResult('wrong');
			return;
		}
		for (const { personId, coord } of placements) {
			const key = `${coord.row},${coord.col}`;
			if (!userPlacements.some((u) => u.key === key && u.personId === personId)) {
				setVerifyResult('wrong');
				return;
			}
		}
		setVerifyResult('correct');
		onComplete();
	}

	function handleUndo() {
		if (undoStack.length === 0) {
			return;
		}
		const next = [...undoStack];
		const last = next.pop()!;
		setCellMarks(last.marks);
		setCommittedCells(last.committed);
		setVerifyResult(null);
		onUndoStackChange(next);
	}

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
				e.preventDefault();
				handleUndo();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	function handleClear() {
		setCellMarks(new Map());
		setCommittedCells(new Map());
		onUndoStackChange([]);
		setVerifyResult(null);
	}

	function handleReset() {
		setCellMarks(new Map());
		setCommittedCells(new Map());
		onUndoStackChange([]);
		setVerifyResult(null);
		onReset();
	}

	const isMobile = windowWidth < 640;
	const availableWidth = Math.min(windowWidth - 32, isMobile ? windowWidth - 32 : 400);
	const cellSize = Math.floor(availableWidth / puzzle.gridSize.cols);

	const solutionMarks = useMemo(() => {
		const m = new Map<string, Set<string>>();
		for (const p of puzzle.solution.placements) {
			m.set(`${p.coord.row},${p.coord.col}`, new Set([p.personId]));
		}
		return m;
	}, [puzzle.solution.placements]);

	const solutionCommitted = useMemo(() => {
		const m = new Map<string, string>();
		for (const p of puzzle.solution.placements) {
			m.set(`${p.coord.row},${p.coord.col}`, p.personId);
		}
		return m;
	}, [puzzle.solution.placements]);

	const effectiveMarks = showSolution ? solutionMarks : cellMarks;
	const effectiveCommitted = showSolution ? solutionCommitted : committedCells;

	const murderer = puzzle.people.find((p) => p.id === puzzle.solution.murdererId)!;
	const victim = puzzle.people.find((p) => p.id === puzzle.solution.victimId)!;
	const murderRoom = puzzle.rooms.find((r) => r.id === puzzle.solution.murderRoom);

	function handleReveal() {
		setShowSolution(true);
		setShowRevealModal(true);
		setPopup(null);
	}

	function handleHide() {
		setShowSolution(false);
		setShowRevealModal(false);
	}

	const popupMarks = popup
		? (cellMarks.get(`${popup.row},${popup.col}`) ?? new Set<string>())
		: new Set<string>();
	const popupCommitted = popup ? committedCells.has(`${popup.row},${popup.col}`) : false;

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				width: '100%',
				maxWidth: 900,
				margin: '0 auto',
			}}
		>
			{/* Header */}
			<div
				style={{
					textAlign: 'center',
					padding: '20px 16px 12px',
					width: '100%',
				}}
			>
				<h1
					style={{
						margin: '0 0 4px 0',
						fontSize: isMobile ? 24 : 31,
						fontWeight: 800,
						color: '#1a1a2e',
						letterSpacing: '-0.02em',
						lineHeight: 1.2,
					}}
				>
					{puzzle.title}
				</h1>
				{puzzle.subtitle && (
					<p
						style={{
							margin: '0 0 16px 0',
							fontSize: 17,
							color: 'rgba(0,0,0,0.45)',
							fontStyle: 'italic',
						}}
					>
						{puzzle.subtitle}
					</p>
				)}

				{/* Suspects list */}
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						gap: 8,
						justifyContent: 'center',
						marginBottom: 16,
					}}
				>
					{[...puzzle.people]
						.sort((a, b) => (a.role === 'victim' ? 1 : 0) - (b.role === 'victim' ? 1 : 0))
						.map((person) => (
							<div
								key={person.id}
								style={{
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
								}}
							>
								<span>{person.avatarEmoji}</span>
								<span>{person.name}</span>
								{person.role === 'victim' && <span style={{ opacity: 0.6 }}>· victim</span>}
							</div>
						))}
				</div>
			</div>

			{/* Main content area */}
			<div
				style={{
					display: 'flex',
					flexDirection: isMobile ? 'column' : 'row',
					gap: 16,
					width: '100%',
					padding: '0 16px 24px',
					alignItems: isMobile ? 'center' : 'flex-start',
					boxSizing: 'border-box',
				}}
			>
				{/* Grid */}
				<div
					style={{
						flexShrink: 0,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 12,
					}}
				>
					<div
						style={{
							borderRadius: 8,
							overflow: 'hidden',
							boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
							border:
								verifyResult === 'correct'
									? '2px solid #16a34a'
									: verifyResult === 'wrong'
										? '2px solid #dc2626'
										: '2px solid rgba(0,0,0,0.15)',
						}}
					>
						<GridCanvas
							puzzle={puzzle}
							cellSize={cellSize}
							cellMarks={effectiveMarks}
							committedCells={effectiveCommitted}
							onCellClick={showSolution ? undefined : handleCellClick}
						/>
					</div>

					{/* Result banner / controls */}
					{!showSolution &&
						(verifyResult === 'correct' ? (
							<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
								<div
									style={{
										padding: '8px 20px',
										background: '#dcfce7',
										color: '#15803d',
										borderRadius: 8,
										fontSize: 15,
										fontWeight: 700,
										border: '1px solid #86efac',
									}}
								>
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
							<div
								style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
							>
								<div style={{ display: 'flex', gap: 8 }}>
									<button
										onClick={handleUndo}
										disabled={undoStack.length === 0}
										title="Undo (⌘Z)"
										style={{
											padding: '10px 14px',
											background: 'transparent',
											color: undoStack.length === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.5)',
											border: '1px solid',
											borderColor: undoStack.length === 0 ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
											borderRadius: 8,
											fontSize: 17,
											cursor: undoStack.length === 0 ? 'default' : 'pointer',
										}}
									>
										↩
									</button>
									<button
										onClick={handleClear}
										disabled={cellMarks.size === 0}
										title="Clear board"
										style={{
											padding: '10px 14px',
											background: 'transparent',
											color: cellMarks.size === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.5)',
											border: '1px solid',
											borderColor: cellMarks.size === 0 ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
											borderRadius: 8,
											fontSize: 13,
											fontWeight: 600,
											cursor: cellMarks.size === 0 ? 'default' : 'pointer',
										}}
									>
										Clear
									</button>
								</div>
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
									<div
										style={{
											fontSize: 13,
											fontWeight: 600,
											color: '#dc2626',
										}}
									>
										Not quite. Keep investigating.
									</div>
								)}
							</div>
						))}
				</div>

				{/* Clues panel */}
				<div
					style={{
						flex: 1,
						minWidth: 0,
						width: isMobile ? '100%' : undefined,
						display: 'flex',
						flexDirection: 'column',
						gap: 12,
					}}
				>
					<CluesPanel
						clues={puzzle.clues}
						people={puzzle.people}
						suspectSummaries={puzzle.suspectSummaries}
						lockedPersonIds={new Set(committedCells.values())}
					/>
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
								alignSelf: 'center',
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
								alignSelf: 'center',
							}}
						>
							Hide Solution
						</button>
					)}
				</div>
			</div>

			{/* How to play */}
			{/* TODO: mention that "besides" an object implies in the same room*/}
			<details
				onToggle={(e) => setHowToPlayOpen((e.currentTarget as HTMLDetailsElement).open)}
				style={{
					width: '100%',
					padding: '0 16px 24px',
					boxSizing: 'border-box',
				}}
			>
				<summary
					style={{
						cursor: 'pointer',
						fontSize: 13,
						fontWeight: 700,
						color: 'rgba(0,0,0,0.35)',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						userSelect: 'none',
						listStyle: 'none',
						display: 'flex',
						alignItems: 'center',
						gap: 5,
					}}
				>
					<span style={{ fontSize: 11 }}>{howToPlayOpen ? '▼' : '▶'}</span>
					How to play
				</summary>
				<div
					style={{
						marginTop: 10,
						padding: '12px 14px',
						background: 'rgba(0,0,0,0.03)',
						borderRadius: 8,
						border: '1px solid rgba(0,0,0,0.08)',
						fontSize: 13,
						lineHeight: 1.6,
						color: '#1a1a2e',
						display: 'flex',
						flexDirection: 'column',
						gap: 7,
					}}
				>
					<p style={{ margin: 0 }}>
						Place every suspect (and the victim) on the grid — one per row, one per column, just
						like Sudoku. People cannot stand on non-occupiable objects (tables, plants,
						bookshelves…).
					</p>
					<p style={{ margin: 0 }}>
						The <strong>murderer</strong> is the suspect who ends up{' '}
						<strong>alone in the same room as the victim</strong> — exactly two people in that room,
						no one else.
					</p>
					<p style={{ margin: 0 }}>
						Click any cell to annotate it with a suspect&apos;s initial (or ✕ to rule someone out).
						When you&apos;re confident about a placement, hit <strong>Lock</strong> to lock it in —
						this clears that person from other cells and marks the rest of their row and column with
						✕. Once everyone is locked, you&apos;ll find out if you solved it.
					</p>
				</div>
			</details>

			{/* Cell mark popup */}
			{popup && (
				<CellPopup
					people={puzzle.people}
					marks={popupMarks}
					committed={popupCommitted}
					position={{ x: popup.x, y: popup.y }}
					onToggle={handleToggleMark}
					onCommit={(personId) => handleCommit(popup.row, popup.col, personId)}
					onUncommit={() => handleUncommit(popup.row, popup.col)}
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
	);
}
