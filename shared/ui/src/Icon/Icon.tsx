import type { JSX } from 'preact';
import styles from './Icon.module.css';

export type IconName =
	| 'file'
	| 'folder'
	| 'folder-open'
	| 'chevron-right'
	| 'chevron-down'
	| 'chevron-left'
	| 'pencil'
	| 'close'
	| 'check'
	| 'x'
	| 'x-mark'
	| 'checkbox-checked'
	| 'checkbox-unchecked'
	| 'robot'
	| 'bullet'
	| 'arrow-left'
	| 'external-link'
	| 'git-branch'
	| 'git-commit'
	| 'github'
	| 'download'
	| 'comment'
	| 'paper-plane'
	| 'plus'
	| 'trash-2'
	| 'rotate-ccw'
	| 'key';

export interface IconProps {
	/** The icon to display */
	name: IconName;
	/** Additional CSS class for styling (use size-xs, size-sm, size-lg, size-xl for sizes) */
	class?: string;
	/** Accessible label for screen readers */
	'aria-label'?: string;
	/** Hide from screen readers when used decoratively */
	'aria-hidden'?: boolean;
}

/**
 * Professional outline-style SVG icons.
 * All icons use a 24x24 viewBox with stroke-based paths.
 *
 * Size classes:
 * - size-xs: 12px
 * - size-sm: 14px
 * - (default): 16px
 * - size-lg: 20px
 * - size-xl: 24px
 * - size-2xl: 32px
 */
const icons: Record<IconName, JSX.Element> = {
	file: (
		<>
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline points="14 2 14 8 20 8" />
		</>
	),
	folder: (
		<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
	),
	'folder-open': (
		<>
			<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1" />
			<path d="M2 10h20l-2 9H4z" />
		</>
	),
	'chevron-right': (
		<polyline points="9 18 15 12 9 6" />
	),
	'chevron-down': (
		<polyline points="6 9 12 15 18 9" />
	),
	'chevron-left': (
		<polyline points="15 18 9 12 15 6" />
	),
	pencil: (
		<>
			<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
		</>
	),
	close: (
		<>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</>
	),
	check: (
		<polyline points="20 6 9 17 4 12" />
	),
	'x-mark': (
		<>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</>
	),
	'checkbox-checked': (
		<>
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
			<polyline points="9 11 12 14 16 10" />
		</>
	),
	'checkbox-unchecked': (
		<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
	),
	robot: (
		<>
			<rect x="3" y="8" width="18" height="12" rx="2" ry="2" />
			<circle cx="7.5" cy="14" r="1.5" />
			<circle cx="16.5" cy="14" r="1.5" />
			<line x1="12" y1="3" x2="12" y2="8" />
			<circle cx="12" cy="3" r="1" />
		</>
	),
	bullet: (
		<circle cx="12" cy="12" r="3" fill="currentColor" />
	),
	'arrow-left': (
		<>
			<line x1="19" y1="12" x2="5" y2="12" />
			<polyline points="12 19 5 12 12 5" />
		</>
	),
	'external-link': (
		<>
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
			<polyline points="15 3 21 3 21 9" />
			<line x1="10" y1="14" x2="21" y2="3" />
		</>
	),
	'git-branch': (
		<>
			<line x1="6" y1="3" x2="6" y2="15" />
			<circle cx="18" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
			<path d="M18 9a9 9 0 0 1-9 9" />
		</>
	),
	'git-commit': (
		<>
			<circle cx="12" cy="12" r="4" />
			<line x1="1.05" y1="12" x2="7" y2="12" />
			<line x1="17" y1="12" x2="22.95" y2="12" />
		</>
	),
	github: (
		<path
			fill="currentColor"
			stroke="none"
			d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
		/>
	),
	download: (
		<>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</>
	),
	x: (
		<>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</>
	),
	comment: (
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
	),
	'paper-plane': (
		<>
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</>
	),
	plus: (
		<>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</>
	),
	'trash-2': (
		<>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
			<line x1="10" y1="11" x2="10" y2="17" />
			<line x1="14" y1="11" x2="14" y2="17" />
		</>
	),
	'rotate-ccw': (
		<>
			<polyline points="1 4 1 10 7 10" />
			<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
		</>
	),
	key: (
		<>
			<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
		</>
	),
};

export function Icon({
	name,
	class: className,
	'aria-label': ariaLabel,
	'aria-hidden': ariaHidden,
}: IconProps): JSX.Element {
	const iconClasses = [styles.icon, className].filter(Boolean).join(' ');

	return (
		<svg
			class={iconClasses}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-label={ariaLabel}
			aria-hidden={ariaHidden ?? !ariaLabel}
			role={ariaLabel ? 'img' : undefined}
		>
			{icons[name]}
		</svg>
	);
}
