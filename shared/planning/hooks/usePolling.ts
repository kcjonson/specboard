import { useEffect, useRef } from 'preact/hooks';

/** How often a planning view asks the server for changes while the window has focus (ms). */
export const POLL_INTERVAL = 10_000;

/** The combined view reads every chosen project at each poll, so it asks less often (multi-project-view.md, decision 4). */
export const COMBINED_POLL_INTERVAL = 30_000;

/** A failed poll doubles the wait before the next, up to this (ms). */
export const POLL_BACKOFF_MAX = 160_000;

/**
 * One poll. Resolving false says it failed, and the next one waits longer; a poll that
 * returns nothing is never backed off (the board's collection tracks its own errors).
 */
export type Poll = () => Promise<boolean> | void;

/**
 * The planning views' background refresh (kanban-ui.md; ai-development-overview.md,
 * decision 12): every 10 s, only while the window has focus, since a backgrounded page
 * shouldn't keep hitting the server. Losing focus stops it. Regaining it polls at once
 * only if the wait has run out since the last poll, which catches up a page left in the
 * background; a refocus sooner waits out the rest, so switching windows costs nothing.
 *
 * `skip` is checked on every tick: while it holds (the source is in an error state, a
 * 429 or an expired session), the poll doesn't run, since retrying on a timer is how a
 * rate limit stays tripped. Recovery is the person's act (a retry), and the ticks resume
 * once it clears. A poll that resolves false backs off: each failure in a row doubles the
 * wait, up to POLL_BACKOFF_MAX, and a success brings it back to the interval.
 *
 * Polls never overlap: the next is timed from when the last one settled.
 */
export function usePolling(poll: Poll, skip: () => boolean = () => false, interval = POLL_INTERVAL): void {
	const latest = useRef({ poll, skip });
	latest.current = { poll, skip };

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let failures = 0;
		let running = false;
		let focused = false;
		// The view's own first load counts as the last read, so nothing polls before a full wait.
		let settledAt = Date.now();

		const delay = (): number => Math.min(interval * 2 ** failures, POLL_BACKOFF_MAX);
		const arm = (wait = delay()): void => {
			clearTimeout(timer);
			timer = focused ? setTimeout(tick, wait) : undefined;
		};
		const tick = async (): Promise<void> => {
			timer = undefined;
			if (running) return;
			if (!latest.current.skip()) {
				running = true;
				try {
					const result = await latest.current.poll();
					if (result === false) failures++;
					else failures = 0;
				} finally {
					running = false;
					settledAt = Date.now();
				}
			}
			arm();
		};
		const onFocus = (): void => {
			focused = true;
			const remaining = delay() - (Date.now() - settledAt);
			if (remaining <= 0) void tick();
			else arm(remaining);
		};
		const onBlur = (): void => {
			focused = false;
			arm();
		};

		focused = document.hasFocus();
		arm();
		window.addEventListener('focus', onFocus);
		window.addEventListener('blur', onBlur);
		return () => {
			focused = false;
			clearTimeout(timer);
			window.removeEventListener('focus', onFocus);
			window.removeEventListener('blur', onBlur);
		};
	}, [interval]);
}
