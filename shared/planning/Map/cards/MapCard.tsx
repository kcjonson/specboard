import type { JSX } from 'preact';
import { memo } from 'preact/compat';
import type { MapItemRow } from '@specboard/core/map-read';
import { Badge, Icon, StatusGlyph } from '@specboard/ui';
import type { DrawDot } from '../draw-list';
import { cardContent } from './card-content';
import { CARD_ANCHOR, CARD_HEIGHT, CARD_WIDTH } from './card-culling';
import styles from './MapCard.module.css';

export interface MapCardProps {
	row: MapItemRow;
	dot: DrawDot;
	/** The scale the card sits at; the card's glyph is centered on its dot there. */
	k: number;
}

/**
 * One item at the near zoom level: its status glyph where its dot is, its key and
 * title, and a mark for each part of the status encoding that has something to say.
 * Display only for now; the layer ignores the pointer so the canvas underneath keeps
 * panning, and hover and selection come with the interaction task.
 */
function MapCardView({ row, dot, k }: MapCardProps): JSX.Element {
	const card = cardContent(row, dot);
	const x = k * dot.x - CARD_ANCHOR.x;
	const y = k * dot.y - CARD_ANCHOR.y;
	return (
		<li class={styles.card} style={{ width: `${CARD_WIDTH}px`, maxHeight: `${CARD_HEIGHT}px`, transform: `translate(${x}px, ${y}px)` }}>
			<div class={styles.head}>
				<span class={card.needsPerson ? `${styles.glyph} ${styles.needsPerson}` : styles.glyph}>
					<StatusGlyph class={styles.status} status={dot.status} />
				</span>
				<span class={styles.key}>{card.key}</span>
				{card.origin && (
					<span class={styles.origin} title={card.origin === 'agent' ? 'Made by an agent' : 'Made by a person'}>
						<Icon name={card.origin === 'agent' ? 'robot' : 'user'} class="size-sm" aria-label={card.origin === 'agent' ? 'Made by an agent' : 'Made by a person'} />
					</span>
				)}
			</div>
			<p class={styles.title}>{card.title}</p>
			<div class={styles.marks}>
				<Badge class={`size-sm ${styles.chip}`}>{card.statusLabel}</Badge>
				{card.subStatus && <Badge class={`size-sm ${styles.chip}`}>{card.subStatus}</Badge>}
				{card.waitingOn && <Badge class={`size-sm ${styles.chip}`}>{card.waitingOn}</Badge>}
				{card.holds > 0 && <Badge class={`size-sm ${styles.chip}`}>{card.holds === 1 ? '1 hold' : `${card.holds} holds`}</Badge>}
				{card.pr && (
					<Badge class={`size-sm ${styles.chip}`}>
						<Icon name="git-branch" class="size-xs" aria-hidden />
						{card.pr}
					</Badge>
				)}
				{card.specs > 0 && (
					<Badge class={`size-sm ${styles.chip}`}>
						<Icon name="file" class="size-xs" aria-hidden />
						{card.specs === 1 ? 'Spec' : `${card.specs} specs`}
					</Badge>
				)}
				{card.family !== null && <Badge class={`size-sm ${styles.chip}`}>{card.family} items</Badge>}
			</div>
		</li>
	);
}

/** A pan leaves every card as it was, so the cards only re-render when their item or the scale changes. */
export const MapCard = memo(MapCardView, (a, b) => a.row === b.row && a.dot === b.dot && a.k === b.k);
