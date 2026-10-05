import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Badge, STATUS_TOKENS, StatusGlyph } from '@specboard/ui';
import type { Rollup } from '../draw-list';
import type { MapPhase } from '../layout/types';
import type { OverlayFrame, OverlayStore } from '../overlay';
import { actorLabel } from '../../utils/actor';
import { formatTimeAgo } from '../../utils/time';
import { ActivityCache, type Activity } from './activity-cache';
import { agentCardHeight, type AgentCard, type QuickMeta } from './agent-content';
import { QUICK_WIDTH, progressText, quickContent, quickHeight } from './quick-content';
import styles from './MapQuickCard.module.css';

export interface MapQuickCardProps {
	store: OverlayStore;
	activity: ActivityCache;
	/** The ruler's band along the bottom of the Map. */
	bottom: number;
}

const PHASES: ReadonlyArray<{ phase: MapPhase; status: keyof typeof STATUS_TOKENS }> = [
	{ phase: 'done', status: 'done' },
	{ phase: 'in_flight', status: 'in_progress' },
	{ phase: 'next', status: 'ready' },
	{ phase: 'later', status: 'blocked' },
];

function Progress({ rollup }: { rollup: Rollup }): JSX.Element {
	const total = rollup.done + rollup.in_flight + rollup.next + rollup.later;
	return (
		<div class={styles.progress}>
			<div class={styles.bar} aria-hidden="true">
				{PHASES.map(({ phase, status }) =>
					rollup[phase] > 0 ? <span key={phase} style={{ width: `${(100 * rollup[phase]) / total}%`, background: `var(${STATUS_TOKENS[status]})` }} /> : null,
				)}
			</div>
			<span class={styles.progressText}>{progressText(rollup)}</span>
		</div>
	);
}

/** The line under a session or an item on a card: the lead is cut with an ellipsis before the times are. */
function MetaLine({ meta }: { meta: QuickMeta }): JSX.Element {
	return (
		<p class={styles.sessionMeta}>
			{meta.lead && <span class={styles.lead}>{meta.lead}</span>}
			{meta.lead && <span class={styles.sep} aria-hidden="true">{' · '}</span>}
			<span class={styles.tail}>{meta.tail}</span>
		</p>
	);
}

/** The card for a session or a computer: what it is, and a block for each session or item it holds. */
function AgentCardView({ card, x, y, side, name }: { card: AgentCard; x: number; y: number; side: string; name: string }): JSX.Element {
	return (
		<article
			class={styles.card}
			data-side={side}
			aria-label={`${name} quick view`}
			style={{ width: `${QUICK_WIDTH}px`, height: `${agentCardHeight(card)}px`, transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` }}
		>
			<div class={styles.head}>
				<span class={styles.key}>{card.kicker}</span>
			</div>
			<p class={styles.title}>{card.title}</p>
			<div class={styles.chips}>
				{card.chips.map((chip) => (
					<Badge key={chip} class={`size-sm ${styles.chip}`}>{chip}</Badge>
				))}
			</div>
			{card.rows.map((row) => (
				<div key={row.key} class={styles.session}>
					<p class={styles.sessionTitle}>
						<span class={styles.ref}>{row.key}</span>
						{row.title && ` ${row.title}`}
					</p>
					<MetaLine meta={row.meta} />
				</div>
			))}
			{card.more > 0 && <p class={styles.line}>{`and ${card.more} more`}</p>}
		</article>
	);
}

function latest(activity: Activity): JSX.Element {
	if (activity.state === 'loading') return <p class={`${styles.entry} ${styles.quiet}`}>Loading...</p>;
	if (activity.state === 'error') return <p class={`${styles.entry} ${styles.quiet}`}>Could not load the latest entry.</p>;
	if (!activity.entry) return <p class={`${styles.entry} ${styles.quiet}`}>No activity yet.</p>;
	return <p class={styles.entry}>{activity.entry.note}</p>;
}

/**
 * The card hover and focus open beside an item (spec, Navigation and interaction): its
 * title, status, sub-status, sessions, blockers, progress, and the latest entry of its
 * activity log, which the Map's read doesn't carry and is fetched when the card opens. The
 * surface decides where it sits and its height follows from what it says, so the card
 * never needs measuring. It takes no pointer: moving onto it is moving off the item.
 */
export function MapQuickCard({ store, activity, bottom }: MapQuickCardProps): JSX.Element {
	const [frame, setFrame] = useState<OverlayFrame>(store.frame);
	const [, refresh] = useState(0);
	useEffect(() => {
		setFrame(store.frame);
		return store.subscribe((next) => setFrame((previous) => (previous.quick === next.quick && previous.rows === next.rows ? previous : next)));
	}, [store]);
	useEffect(() => activity.subscribe(() => refresh((n) => n + 1)), [activity]);

	const { quick, rows } = frame;
	const key = quick?.key;
	const itemKey = quick?.agent ? undefined : key;
	useEffect(() => {
		if (itemKey) activity.request(itemKey);
	}, [itemKey, activity]);

	if (quick?.agent) {
		return (
			<div class={styles.layer} style={{ bottom: `${bottom}px` }}>
				<AgentCardView key={quick.key} card={quick.agent} x={quick.x} y={quick.y} side={quick.side} name={quick.agent.title} />
			</div>
		);
	}
	const row = key ? rows.get(key) : undefined;
	if (!quick || !row) return <div class={styles.layer} style={{ bottom: `${bottom}px` }} />;
	const content = quickContent(row, rows, quick.progress, quick.marks);
	const entry = activity.get(quick.key);
	const meta = entry.state === 'ready' && entry.entry ? ` · ${entry.entry.actor ? `${actorLabel(entry.entry.actor)} · ` : ''}${formatTimeAgo(entry.entry.createdAt)}` : '';
	return (
		<div class={styles.layer} style={{ bottom: `${bottom}px` }}>
			<article
				key={quick.key}
				class={styles.card}
				data-side={quick.side}
				aria-label={`${content.key} quick view`}
				style={{ width: `${QUICK_WIDTH}px`, height: `${quickHeight(content)}px`, transform: `translate(${Math.round(quick.x)}px, ${Math.round(quick.y)}px)` }}
			>
				{content.needs && (
					<p class={styles.reason} title={content.needs.text}>
						<span class={styles.tag} aria-hidden="true">{content.needs.tag}</span>
						{content.needs.text}
					</p>
				)}
				<div class={styles.head}>
					<StatusGlyph class={styles.glyph} status={row.status} blocked={row.blocked} decorative />
					<span class={styles.key}>{content.key}</span>
				</div>
				<p class={styles.title}>{content.title}</p>
				<div class={styles.chips}>
					<Badge class={`size-sm ${styles.chip}`}>{content.statusLabel}</Badge>
					{content.subStatus && <Badge class={`size-sm ${styles.chip}`}>{content.subStatus}</Badge>}
				</div>
				{content.changes.map((line) => <p key={line} class={`${styles.line} ${styles.change}`} title={line}>{line}</p>)}
				{content.upNext !== null && <p class={styles.line}>{`Up next: number ${content.upNext}`}</p>}
				{content.sessions.map((session) => (
					<div key={session.title} class={styles.session}>
						<p class={styles.sessionTitle}>{session.title}</p>
						<MetaLine meta={session.meta} />
					</div>
				))}
				{content.moreSessions > 0 && <p class={styles.line}>{`and ${content.moreSessions} more`}</p>}
				{content.blockers.map((blocker) => (
					<p key={blocker.key} class={styles.line}>
						Waiting on <span class={styles.ref}>{blocker.key}</span>
						{blocker.title && ` ${blocker.title}`}
					</p>
				))}
				{content.moreBlockers > 0 && <p class={styles.line}>{`and ${content.moreBlockers} more`}</p>}
				{content.holds > 0 && <p class={styles.line}>{content.holds === 1 ? 'Held by 1 text blocker' : `Held by ${content.holds} text blockers`}</p>}
				{content.progress && <Progress rollup={content.progress} />}
				<div class={styles.activity}>
					<span class={styles.meta}>{`Latest activity${meta}`}</span>
					{latest(entry)}
				</div>
			</article>
		</div>
	);
}
