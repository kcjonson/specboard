import type { JSX } from 'preact';
import { WORDMARK_PATH, WORDMARK_WIDTH, WORDMARK_HEIGHT, WORDMARK_BASELINE } from './wordmark';
import styles from './Logo.module.css';

export interface LogoProps {
	/** Mark height in px (mark is 8:5, width derives from this) */
	size?: number;
	/** Render the wordmark next to the mark */
	wordmark?: boolean;
	/** Wrap the logo in a link to this href */
	href?: string;
	/** Additional CSS class */
	class?: string;
}

/** Card baseline within the mark's 240x150 grid (docs/brand.md) */
const MARK_BASELINE_RATIO = 122 / 150;
/** Wordmark cap height relative to the mark height in a lockup */
const WORDMARK_SCALE = 0.55;

/** The bare logomark: prompt chevron + kanban card (see docs/brand.md) */
export function LogoMark({ size = 20 }: { size?: number }): JSX.Element {
	const width = Math.round((240 / 150) * size);
	return (
		<svg width={width} height={size} viewBox="0 0 240 150" aria-hidden="true" class={styles.mark}>
			<polygon points="28,30 76,62 28,94" />
			{size > 32 && <rect class={styles.ghost} x="126" y="46" width="92" height="30" rx="7" />}
			<rect x="108" y="92" width="92" height="30" rx="7" />
		</svg>
	);
}

export function Logo({ size = 20, wordmark = true, href, class: className }: LogoProps): JSX.Element {
	const wordHeight = Math.round(size * WORDMARK_SCALE);
	const wordWidth = Math.round((WORDMARK_WIDTH / WORDMARK_HEIGHT) * wordHeight);
	// Sit the wordmark baseline on the card baseline
	const wordOffset = Math.round(size * MARK_BASELINE_RATIO - wordHeight * (WORDMARK_BASELINE / WORDMARK_HEIGHT));
	const content = (
		<>
			<LogoMark size={size} />
			{wordmark && (
				<svg
					width={wordWidth}
					height={wordHeight}
					viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`}
					aria-hidden="true"
					class={styles.word}
					style={{ marginTop: `${wordOffset}px` }}
				>
					<path d={WORDMARK_PATH} />
				</svg>
			)}
		</>
	);
	const classes = `${styles.logo} ${className || ''}`;
	return href ? (
		<a href={href} class={classes} aria-label="Specboard">
			{content}
		</a>
	) : (
		<span class={classes} aria-label="Specboard">
			{content}
		</span>
	);
}
