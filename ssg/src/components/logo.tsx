/**
 * Brand logo for SSG pages (see docs/brand.md).
 *
 * Standalone twin of shared/ui Logo - the SSG build runs under tsx and
 * cannot import CSS modules, so this uses plain classes styled in
 * shared/styles/common.css. Geometry is shared via wordmark.ts.
 *
 * Two forms only: the lockup (this component) and the bare mark.
 * The wordmark never appears without the mark.
 */
import type { JSX } from 'preact';
import {
	WORDMARK_PATH,
	LOCKUP_VIEWBOX_WIDTH,
	LOCKUP_VIEWBOX_HEIGHT,
	LOCKUP_WORD_TRANSFORM,
} from '../../../shared/ui/src/Logo/wordmark';

export interface BrandLogoProps {
	/** Mark height in px (the lockup scales from this) */
	size?: number;
	/** Wrap the logo in a link to this href */
	href?: string;
	class?: string;
}

export function BrandLogo({ size = 20, href, class: className }: BrandLogoProps): JSX.Element {
	const width = Math.round((LOCKUP_VIEWBOX_WIDTH / LOCKUP_VIEWBOX_HEIGHT) * size);
	const svg = (
		<svg
			width={width}
			height={size}
			viewBox={`0 0 ${LOCKUP_VIEWBOX_WIDTH} ${LOCKUP_VIEWBOX_HEIGHT}`}
			aria-hidden="true"
			class="brand-mark"
		>
			<polygon points="28,30 76,62 28,94" />
			{size > 32 && <rect class="brand-ghost" x="126" y="46" width="92" height="30" rx="7" />}
			<rect x="108" y="92" width="92" height="30" rx="7" />
			<g transform={LOCKUP_WORD_TRANSFORM}>
				<path class="brand-word" d={WORDMARK_PATH} />
			</g>
		</svg>
	);
	const classes = `brand-logo ${className || ''}`;
	return href ? (
		<a href={href} class={classes} aria-label="Specboard">
			{svg}
		</a>
	) : (
		<span class={classes} role="img" aria-label="Specboard">
			{svg}
		</span>
	);
}
