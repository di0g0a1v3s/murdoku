import type { Person } from '@shared/types';

interface CellPopupProps {
	people: Person[];
	marks: Set<string>;
	position: { x: number; y: number };
	onToggle: (mark: string) => void;
	onClose: () => void;
}

// TODO: button to "commit" position
export function CellPopup({ people, marks, position, onToggle, onClose }: CellPopupProps) {
	const POPUP_W = 44 * Math.min(people.length + 1, 6) + 16;
	const POPUP_H = people.length + 1 > 6 ? 108 : 60;

	const left = Math.max(8, Math.min(position.x - POPUP_W / 2, window.innerWidth - POPUP_W - 8));
	const top =
		position.y + 12 + POPUP_H > window.innerHeight ? position.y - POPUP_H - 12 : position.y + 12;

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
					flexWrap: 'wrap',
					gap: 6,
					maxWidth: 260,
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{people.map((person) => {
					// TODO: victim at the end
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
				{/* X button */}
				<button
					onClick={() => onToggle('X')}
					style={{
						width: 38,
						height: 38,
						borderRadius: 8,
						border: '2px solid',
						borderColor: marks.has('X') ? '#dc2626' : 'rgba(0,0,0,0.15)',
						background: marks.has('X') ? '#dc2626' : 'white',
						color: marks.has('X') ? 'white' : '#999',
						fontSize: 15,
						fontWeight: 700,
						cursor: 'pointer',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						lineHeight: 1,
					}}
					title="Mark as empty"
				>
					✕
				</button>
			</div>
		</>
	);
}
