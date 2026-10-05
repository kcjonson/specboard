import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon, StatusGlyph } from '@specboard/ui';
import type { ItemStatus } from '@specboard/models';
import type { MapPhase } from '../layout/types';
import type { MapSummary } from '../map-facts';
import type { MapFilters } from '../map-lens';
import type { SummaryText } from '../changes/changes';
import { FIT, useStripFit } from './fit';
import { freshnessText } from './freshness';
import styles from './SummaryStrip.module.css';

export interface SummaryStripProps {
	/** Null until the first read and layout land: the strip draws with dashes for counts. */
	summary: MapSummary | null;
	filters: MapFilters;
	onTogglePhase(phase: MapPhase): void;
	onToggleNeedsPerson(): void;
	onToggleLive(): void;
	/** When the read last loaded, epoch ms. */
	updatedAt: number | null;
	/** The last refresh failed and the Map is showing what it had. */
	retrying?: boolean;
	/** The "Agents at work" button, which opens the roster of computers and sessions. */
	agents?: ComponentChildren;
	/**
	 * Since your last visit: what changed, by kind, which opens the changes view and, while it
	 * is open, is pressed. Absent when nothing is waiting. The text comes at three lengths, for
	 * a strip with less and less room.
	 */
	since?: { date: string; text: SummaryText; open: boolean; onToggle(): void };
	/** Whether changes made elsewhere are said to a screen reader, and the switch for it. Absent, the strip has no such control. */
	announce?: { on: boolean; onToggle(): void };
	/** The clock the freshness note reads, so a test can drive it. */
	clock?: () => number;
}

/** The phases in the strip's order, with the status glyph each is drawn with (the rollup bar's pairing). */
const PHASES: ReadonlyArray<{ phase: MapPhase; label: string; status: ItemStatus; hint: string }> = [
	{ phase: 'done', label: 'Done', status: 'done', hint: 'Finished' },
	{ phase: 'in_flight', label: 'In flight', status: 'in_progress', hint: 'In progress or in review, and a hold that had started' },
	{ phase: 'next', label: 'Next', status: 'ready', hint: 'Ready with nothing blocking it: what an agent picks up' },
	{ phase: 'later', label: 'Later', status: 'blocked', hint: 'Ready but waiting on a blocker, or a hold that never started' },
];

/** How often the freshness note is read again, so "just now" turns into minutes without a refresh. */
const TICK_MS = 30_000;

/**
 * The summary strip (spec, Summary strip), fixed above the canvas: counts per phase, blocked,
 * needs a person, live agent sessions, what changed since the person last looked, and when the data last loaded. The counts that name a
 * filter are its buttons: pressing one dims everything else on the Map, pressing it again
 * puts everything back. Blocked is a count only, since it isn't a phase. When the line runs
 * out of room the labels that can be said shorter are (see `FIT` for the order); the phase
 * words never are, and the strip wraps before it drops one.
 */
export function SummaryStrip({ summary, filters, onTogglePhase, onToggleNeedsPerson, onToggleLive, updatedAt, retrying = false, agents, since, announce, clock = Date.now }: SummaryStripProps): JSX.Element {
	const [now, setNow] = useState(clock);
	useEffect(() => {
		setNow(clock());
		const timer = window.setInterval(() => setNow(clock()), TICK_MS);
		return () => window.clearInterval(timer);
	}, [updatedAt, clock]);

	const stripRef = useRef<HTMLElement>(null);
	const fullFreshness = updatedAt === null ? '' : freshnessText(updatedAt, now, retrying);
	const fit = useStripFit(stripRef, [JSON.stringify(summary), since?.date, since?.text.full, fullFreshness, announce !== undefined, agents !== undefined].join('|'));

	const count = (value: number | undefined): string => (value === undefined ? '-' : String(value));
	const ready = summary !== null;
	return (
		<section ref={stripRef} class={fit >= FIT.wrap ? `${styles.strip} ${styles.wrap}` : styles.strip} aria-label="Project summary">
			{PHASES.map(({ phase, label, status, hint }) => (
				<button key={phase} type="button" class={styles.chip} aria-pressed={filters.phases.has(phase)} disabled={!ready} title={hint} onClick={() => onTogglePhase(phase)}>
					<StatusGlyph class={styles.glyph} status={status} decorative />
					<span class={styles.label}>{label}</span>
					<span class={styles.count}>{count(summary?.phases[phase])}</span>
				</button>
			))}
			<span class={styles.divider} aria-hidden="true" />
			<span class={styles.plain} title="Held, or waiting on an open blocker, whatever the status">
				<span class={styles.label}>Blocked</span>
				<span class={styles.count}>{count(summary?.blocked)}</span>
			</span>
			<button type="button" class={styles.chip} aria-pressed={filters.needsPerson} disabled={!ready} title="A question, a review, a hold, or a deadlock" onClick={onToggleNeedsPerson}>
				<span class={styles.ring} aria-hidden="true" />
				<span class={styles.label}>Needs a person</span>
				<span class={styles.count}>{count(summary?.needsPerson)}</span>
			</button>
			<button type="button" class={styles.chip} aria-pressed={filters.live} disabled={!ready} title="Agent sessions that wrote in the last 15 minutes" onClick={onToggleLive}>
				<span class={styles.glow} aria-hidden="true" />
				<span class={styles.label}>Live sessions</span>
				<span class={styles.count}>{count(summary?.liveSessions)}</span>
			</button>
			{agents}
			{since && (
				<button type="button" class={`${styles.chip} ${styles.since}`} aria-pressed={since.open} title={`Since ${since.date}: ${since.text.full}. Opens the changes view.`} onClick={since.onToggle}>
					<span class={styles.label}>
						{`Since ${since.date}: `}
						<span class={styles.changes}>{fit >= FIT.sinceTotal ? since.text.total : fit >= FIT.sinceLead ? since.text.lead : since.text.full}</span>
					</span>
				</button>
			)}
			<span class={styles.spacer} />
			{announce && (
				<button type="button" class={styles.chip} aria-pressed={announce.on} aria-label={fit >= FIT.announceIcon ? 'Announce changes' : undefined} title="Say changes made elsewhere to a screen reader, a few at a time" onClick={announce.onToggle}>
					{fit >= FIT.announceIcon ? (
						<Icon name="volume" class={styles.announceIcon} aria-hidden />
					) : (
						<>
							<span class={styles.label}>Announce changes</span>
							<span class={styles.count}>{announce.on ? 'On' : 'Off'}</span>
						</>
					)}
				</button>
			)}
			{updatedAt !== null && (
				<span class={styles.fresh} title={fit >= FIT.freshShort ? fullFreshness : undefined}>
					{fit >= FIT.freshShort ? freshnessText(updatedAt, now, retrying, true) : fullFreshness}
				</span>
			)}
		</section>
	);
}
