/**
 * Brand logo for SSG pages (see docs/brand.md).
 *
 * Standalone twin of shared/ui Logo - the SSG build runs under tsx and
 * cannot import CSS modules, so this uses plain classes styled in
 * shared/styles/common.css. The wordmark geometry is shared.
 */
import type { JSX } from 'preact';
import {
	WORDMARK_PATH,
	WORDMARK_WIDTH,
	WORDMARK_HEIGHT,
	WORDMARK_BASELINE,
} from '../../../shared/ui/src/Logo/wordmark';

export interface BrandLogoProps {
	/** Mark height in px (mark is 8:5, width derives from this) */
	size?: number;
	/** Render the wordmark next to the mark */
	wordmark?: boolean;
	/** Wrap the logo in a link to this href */
	href?: string;
	class?: string;
}

const MARK_BASELINE_RATIO = 122 / 150;
const WORDMARK_SCALE = 0.55;

export function BrandLogo({ size = 20, wordmark = true, href, class: className }: BrandLogoProps): JSX.Element {
	const markWidth = Math.round((240 / 150) * size);
	const wordHeight = Math.round(size * WORDMARK_SCALE);
	const wordWidth = Math.round((WORDMARK_WIDTH / WORDMARK_HEIGHT) * wordHeight);
	const wordOffset = Math.round(size * MARK_BASELINE_RATIO - wordHeight * (WORDMARK_BASELINE / WORDMARK_HEIGHT));
	const content = (
		<>
			<svg width={markWidth} height={size} viewBox="0 0 240 150" aria-hidden="true" class="brand-mark">
				<polygon points="28,30 76,62 28,94" />
				{size >= 32 && <rect class="brand-ghost" x="126" y="46" width="92" height="30" rx="7" />}
				<rect x="108" y="92" width="92" height="30" rx="7" />
			</svg>
			{wordmark && (
				<svg
					width={wordWidth}
					height={wordHeight}
					viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`}
					aria-hidden="true"
					class="brand-word"
					style={`margin-top: ${wordOffset}px`}
				>
					<path d={WORDMARK_PATH} />
				</svg>
			)}
		</>
	);
	const classes = `brand-logo ${className || ''}`;
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
