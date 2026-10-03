import type { JSX } from 'preact';
import type { ItemStatus } from '@specboard/models';
import { GLYPH_BOX, RING_WIDTH, STATUS_GLYPHS, glyphStatus } from '../status-glyph';
import { STATUS_LABELS } from '../status';
import styles from './StatusGlyph.module.css';

export interface StatusGlyphProps {
	status: ItemStatus;
	/** The item's derived blocked flag; when set, the glyph shows Blocked whatever the status. */
	blocked?: boolean;
	/** Hide from assistive tech where the status is already written out beside the glyph. */
	decorative?: boolean;
	class?: string;
}

export function StatusGlyph({
	status,
	blocked,
	decorative,
	class: className,
}: StatusGlyphProps): JSX.Element {
	const shown = glyphStatus(status, blocked);
	const spec = STATUS_GLYPHS[shown];

	return (
		<svg
			class={className ? `${styles.glyph} ${className}` : styles.glyph}
			style={{ color: `var(${spec.token})` }}
			viewBox={`0 0 ${GLYPH_BOX} ${GLYPH_BOX}`}
			role={decorative ? undefined : 'img'}
			aria-label={decorative ? undefined : STATUS_LABELS[shown]}
			aria-hidden={decorative ? true : undefined}
		>
			{spec.stroke && (
				<path d={spec.stroke} fill="none" stroke="currentColor" stroke-width={RING_WIDTH} />
			)}
			{spec.fill && <path d={spec.fill} fill="currentColor" fill-rule="evenodd" />}
		</svg>
	);
}
