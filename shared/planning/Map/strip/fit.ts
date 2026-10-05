import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * What the summary strip gives up as its line runs out of room, in order. Each level keeps
 * everything the level before it gave up, and none of them touches a phase word, Blocked,
 * Needs a person, or Live sessions: when everything else has yielded, the strip wraps.
 */
export const FIT = {
	full: 0,
	/** "Agents at work" is the laptop icon, named for assistive tech. */
	agentsIcon: 1,
	/** "Since Sep 23: 86 finished, +3 more kinds" */
	sinceLead: 2,
	/** "Since Sep 23: 94 items changed" */
	sinceTotal: 3,
	/** "Updated now" */
	freshShort: 4,
	/** The announce switch is its icon, named for assistive tech. */
	announceIcon: 5,
	wrap: 6,
} as const;

/**
 * Whether the line's last item ends past the strip's padding. `scrollWidth` would miss an item
 * that crowds into the padding without leaving the box, leaving the freshness note touching the edge.
 */
function overflows(strip: HTMLElement): boolean {
	const last = strip.lastElementChild;
	if (!last) return false;
	const padding = parseFloat(window.getComputedStyle(strip).paddingRight) || 0;
	return last.getBoundingClientRect().right > strip.getBoundingClientRect().right - padding;
}

/**
 * The lowest level at which the strip's one line fits, found by measuring the real layout:
 * whether a label fits depends on the counts, the since text, and the font, none of which a
 * breakpoint can know. Every render checks the line against its box and, when it overflows,
 * steps one level up before the browser paints, so a person never sees the overflow. Anything
 * that can make the full strip wider (the `signature`) or a change in the strip's own width
 * starts again from the top, so the strip gets its words back when room returns.
 */
export function useStripFit(ref: RefObject<HTMLElement>, signature: string): number {
	const [state, setState] = useState({ signature, level: 0 });
	const level = state.signature === signature ? state.level : 0;
	const signatureRef = useRef(signature);
	signatureRef.current = signature;

	useLayoutEffect(() => {
		const strip = ref.current;
		if (strip && level < FIT.wrap && overflows(strip)) setState({ signature, level: level + 1 });
	});

	useEffect(() => {
		const strip = ref.current;
		if (!strip) return undefined;
		const restart = (): void => setState({ signature: signatureRef.current, level: 0 });
		let width = strip.clientWidth;
		const observer = typeof ResizeObserver === 'function'
			? new ResizeObserver(() => {
				if (strip.clientWidth === width) return;
				width = strip.clientWidth;
				restart();
			})
			: null;
		observer?.observe(strip);
		// The label font arrives after first paint, and widens everything it sets.
		void document.fonts?.ready.then(restart);
		return () => observer?.disconnect();
	}, [ref]);

	return level;
}
