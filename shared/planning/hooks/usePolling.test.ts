/**
 * The planning views' poll: the cadence, the focus rule, skipping while in error, and
 * backing off after failures.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { COMBINED_POLL_INTERVAL, POLL_BACKOFF_MAX, POLL_INTERVAL, usePolling, type Poll } from './usePolling';

let focused = true;

beforeEach(() => {
	vi.useFakeTimers();
	focused = true;
	vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const focus = (): void => {
	focused = true;
	window.dispatchEvent(new Event('focus'));
};

const blur = (): void => {
	focused = false;
	window.dispatchEvent(new Event('blur'));
};

/** Moves the clock and lets the polls it fires settle. */
const wait = async (ms: number): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};

describe('usePolling', () => {
	it('polls every 10 s while the window has focus', async () => {
		const poll = vi.fn<Poll>();
		renderHook(() => usePolling(poll));

		await wait(POLL_INTERVAL - 1);
		expect(poll).not.toHaveBeenCalled();
		await wait(1);
		expect(poll).toHaveBeenCalledTimes(1);
		await wait(2 * POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(3);
	});

	it('polls at the interval it is given instead, as the multi-project view does every 30 s', async () => {
		const poll = vi.fn<Poll>();
		renderHook(() => usePolling(poll, undefined, COMBINED_POLL_INTERVAL));

		await wait(COMBINED_POLL_INTERVAL - 1);
		expect(poll).not.toHaveBeenCalled();
		await wait(1);
		expect(poll).toHaveBeenCalledTimes(1);
		await wait(2 * COMBINED_POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(3);
	});

	it('stops when the window loses focus, and polls at once when it comes back', async () => {
		const poll = vi.fn<Poll>();
		renderHook(() => usePolling(poll));

		blur();
		await wait(5 * POLL_INTERVAL);
		expect(poll).not.toHaveBeenCalled();

		focus();
		await wait(0);
		expect(poll).toHaveBeenCalledTimes(1);
		await wait(POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(2);
	});

	it('does not start in a window that opened without focus', async () => {
		focused = false;
		const poll = vi.fn<Poll>();
		renderHook(() => usePolling(poll));

		await wait(3 * POLL_INTERVAL);
		expect(poll).not.toHaveBeenCalled();
	});

	it('skips its polls while the source is in error, focus included, and resumes once it clears', async () => {
		const poll = vi.fn<Poll>();
		let error = true;
		renderHook(() => usePolling(poll, () => error));

		await wait(3 * POLL_INTERVAL);
		blur();
		focus();
		await wait(0);
		expect(poll).not.toHaveBeenCalled();

		error = false;
		await wait(POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(1);
	});

	it('backs off after each failure in a row, up to its ceiling, and comes back after a success', async () => {
		let failing = true;
		const poll = vi.fn<Poll>(() => Promise.resolve(!failing));
		renderHook(() => usePolling(poll));

		await wait(POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(1);
		// 20 s after one failure, then 40 s.
		await wait(2 * POLL_INTERVAL - 1);
		expect(poll).toHaveBeenCalledTimes(1);
		await wait(1);
		expect(poll).toHaveBeenCalledTimes(2);
		await wait(4 * POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(3);
		// It never waits longer than the ceiling.
		await wait(POLL_BACKOFF_MAX * 4);
		const calls = poll.mock.calls.length;
		await wait(POLL_BACKOFF_MAX);
		expect(poll.mock.calls.length).toBe(calls + 1);

		failing = false;
		await wait(POLL_BACKOFF_MAX);
		const recovered = poll.mock.calls.length;
		await wait(POLL_INTERVAL);
		expect(poll.mock.calls.length).toBe(recovered + 1);
	});

	it('does not let a refocus cut a backoff short', async () => {
		const poll = vi.fn<Poll>(() => Promise.resolve(false));
		renderHook(() => usePolling(poll));

		await wait(POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(1);
		blur();
		focus();
		await wait(0);
		expect(poll).toHaveBeenCalledTimes(1);
		await wait(2 * POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(2);
	});

	it('never overlaps two polls: the next is timed from when the last one settled', async () => {
		let finish: (ok: boolean) => void = () => {};
		const poll = vi.fn<Poll>(() => new Promise<boolean>((resolve) => (finish = resolve)));
		renderHook(() => usePolling(poll));

		await wait(POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(1);
		await wait(3 * POLL_INTERVAL);
		focus();
		await wait(0);
		expect(poll).toHaveBeenCalledTimes(1);

		finish(true);
		await wait(POLL_INTERVAL);
		expect(poll).toHaveBeenCalledTimes(2);
	});

	it('stops for good on unmount', async () => {
		const poll = vi.fn<Poll>();
		const { unmount } = renderHook(() => usePolling(poll));
		unmount();

		focus();
		await wait(3 * POLL_INTERVAL);
		expect(poll).not.toHaveBeenCalled();
	});
});
