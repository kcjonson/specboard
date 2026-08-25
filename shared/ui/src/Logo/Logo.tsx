import type { JSX } from 'preact';
import {
	WORDMARK_PATH,
	LOCKUP_VIEWBOX_WIDTH,
	LOCKUP_VIEWBOX_HEIGHT,
	LOCKUP_WORD_TRANSFORM,
} from './wordmark';
import styles from './Logo.module.css';

export interface LogoProps {
	/** Mark height in px (the lockup scales from this) */
	size?: number;
	/** Wrap the logo in a link to this href */
	href?: string;
	/** Additional CSS class */
	class?: string;
}

/**
 * The brand has exactly two forms (docs/brand.md):
 * - LogoMark: the mark alone
 * - Logo: the lockup, mark + wordmark in one SVG
 * The wordmark never appears without the mark.
 */

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

export function Logo({ size = 20, href, class: className }: LogoProps): JSX.Element {
	const width = Math.round((LOCKUP_VIEWBOX_WIDTH / LOCKUP_VIEWBOX_HEIGHT) * size);
	const svg = (
		<svg
			width={width}
			height={size}
			viewBox={`0 0 ${LOCKUP_VIEWBOX_WIDTH} ${LOCKUP_VIEWBOX_HEIGHT}`}
			aria-hidden="true"
			class={styles.mark}
		>
			<polygon points="28,30 76,62 28,94" />
			{size > 32 && <rect class={styles.ghost} x="126" y="46" width="92" height="30" rx="7" />}
			<rect x="108" y="92" width="92" height="30" rx="7" />
			<g transform={LOCKUP_WORD_TRANSFORM}>
				<path class={styles.word} d={WORDMARK_PATH} />
			</g>
		</svg>
	);
	const classes = `${styles.logo} ${className || ''}`;
	return href ? (
		<a href={href} class={classes} aria-label="Specboard">
			{svg}
		</a>
	) : (
		<span class={classes} aria-label="Specboard">
			{svg}
		</span>
	);
}
