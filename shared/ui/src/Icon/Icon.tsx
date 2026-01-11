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
	| 'download'
	| 'comment'
	| 'paper-plane'
	| 'plus'
	| 'trash-2'
	| 'rotate-ccw';

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
