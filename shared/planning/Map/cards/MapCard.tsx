import type { JSX } from 'preact';
import { memo } from 'preact/compat';
import type { MapItemRow } from '@specboard/core/map-read';
import { Badge, Icon, StatusGlyph } from '@specboard/ui';
import type { DrawDot } from '../draw-list';
import { cardContent, fitChips } from './card-content';
import { CARD_ANCHOR, CARD_HEIGHT, CARD_WIDTH } from './card-culling';
import styles from './MapCard.module.css';

export interface MapCardProps {
	row: MapItemRow;
	dot: DrawDot;
	/** The scale the card sits at; the card's glyph is centered on its dot there. */
	k: number;
	/** Hover, focus, or selection has lit something else: this card fades with everything outside the related set. */
	faded: boolean;
	/** This is the item hover, focus, or selection is on. */
	lit: boolean;
}

/**
 * One item at the near zoom level: its status glyph where its dot is, its key and
 * title, and a mark for each part of the status encoding that has something to say.
 * The layer ignores the pointer: the canvas under it takes hover and clicks on a card as
 * it does on the card's dot, and a drag from the card's body pans.
 */
function MapCardView({ row, dot, k, faded, lit }: MapCardProps): JSX.Element {
	const card = cardContent(row, dot);
	const { shown, hidden } = fitChips(card.chips);
	const x = k * dot.x - CARD_ANCHOR.x;
	const y = k * dot.y - CARD_ANCHOR.y;
	return (
		<li
			class={`${styles.card}${faded ? ` ${styles.faded}` : ''}${lit ? ` ${styles.lit}` : ''}`}
			data-key={card.key}
			style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px`, transform: `translate(${x}px, ${y}px)` }}
		>
			<div class={styles.head}>
				<span class={`${styles.glyph}${card.live ? ` ${styles.live}` : ''}${card.reason ? ` ${styles.needsPerson}` : ''}`}>
					<StatusGlyph class={styles.status} status={dot.status} />
				</span>
				<span class={styles.key}>{card.key}</span>
				{card.reason && (
					<span class={styles.tag} title={card.reason.text}>
						<span aria-hidden="true">{card.reason.tag}</span>
						<span class={styles.more}>{card.reason.text}</span>
					</span>
				)}
				{card.upNext !== null && (
					<span class={styles.upNext} title={`Up next: number ${card.upNext}`}>
						<span aria-hidden="true">{card.upNext}</span>
						<span class={styles.more}>{`Up next: number ${card.upNext}`}</span>
					</span>
				)}
				{card.origin && (
					<span class={styles.origin} title={card.origin === 'agent' ? 'Made by an agent' : 'Made by a person'}>
						<Icon name={card.origin === 'agent' ? 'robot' : 'user'} class="size-sm" aria-label={card.origin === 'agent' ? 'Made by an agent' : 'Made by a person'} />
					</span>
				)}
			</div>
			<p class={styles.title}>{card.title}</p>
			<div class={styles.marks}>
				{shown.map((chip) => (
					<Badge key={chip.text} class={`size-sm ${styles.chip}`}>
						{chip.icon && <Icon name={chip.icon} class="size-xs" aria-hidden />}
						{chip.text}
					</Badge>
				))}
				{hidden > 0 && (
					<Badge class={`size-sm ${styles.chip}`}>
						<span aria-hidden="true">+{hidden}</span>
						<span class={styles.more}>{`Also: ${card.chips.slice(shown.length).map((chip) => chip.text).join(', ')}`}</span>
					</Badge>
				)}
			</div>
		</li>
	);
}

/** A pan leaves every card as it was, so the cards only re-render when their item or the scale changes. */
export const MapCard = memo(MapCardView, (a, b) => a.row === b.row && a.dot === b.dot && a.k === b.k && a.faded === b.faded && a.lit === b.lit);
