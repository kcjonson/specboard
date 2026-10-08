/**
 * The Map's poll: the read and, on a project's own Map, the changes since the last visit.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { COMBINED_POLL_INTERVAL, POLL_INTERVAL } from '../hooks/usePolling';
import { MapChangesModel } from './changes/changes-model';
import { memoryCollapseStore } from './collapse-store.fixture';
import { wholeRead } from './layout/board-fixture';
import { MapDataModel } from './map-data-model';
import { useMapUpdates } from './useMapUpdates';

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const dataModel = (): MapDataModel => new MapDataModel(
	[{ ref: 'acme/specboard', read: () => Promise.resolve(wholeRead([])) }],
	() => ({ layout: () => new Promise(() => {}), outlines: () => Promise.resolve([]), terminate: () => {} }),
	memoryCollapseStore(),
);

const changesModel = (): MapChangesModel => new MapChangesModel({
	read: () => Promise.resolve({ baseline: null, readAt: 0, changes: [] }),
	advance: () => Promise.resolve(),
});

describe('useMapUpdates', () => {
	it('asks the read and the changes together on a project\'s own Map, every 10 s', async () => {
		const model = dataModel();
		const changes = changesModel();
		const read = vi.spyOn(model, 'refresh');
		const since = vi.spyOn(changes, 'refresh');
		renderHook(() => useMapUpdates(model, changes, POLL_INTERVAL));

		await vi.advanceTimersByTimeAsync(POLL_INTERVAL);
		expect(read).toHaveBeenCalledTimes(1);
		expect(since).toHaveBeenCalledTimes(1);
	});

	it('asks only the read on the combined view, which has no changes layer, every 30 s', async () => {
		const model = dataModel();
		const read = vi.spyOn(model, 'refresh');
		renderHook(() => useMapUpdates(model, null, COMBINED_POLL_INTERVAL));

		await vi.advanceTimersByTimeAsync(COMBINED_POLL_INTERVAL - 1);
		expect(read).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(read).toHaveBeenCalledTimes(1);
	});
});
