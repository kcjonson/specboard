/**
 * SyncProgressDialog: the first status polls can land before the server has
 * written any sync status, and the dialog has to ride that out.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render } from '@testing-library/preact';
import { fetchClient } from '@specboard/fetch';
import { SyncProgressDialog } from './SyncProgressDialog';

vi.mock('@specboard/fetch', () => ({
	fetchClient: { get: vi.fn(), post: vi.fn() },
	FetchError: class extends Error {},
}));

const get = vi.mocked(fetchClient.get);

const STATUS_URL = '/api/projects/docs/sync/status';

function status(value: string | null, error: string | null = null): { status: string | null; error: string | null } {
	return { status: value, error };
}

function renderDialog(): ReturnType<typeof render> {
	return render(
		<SyncProgressDialog projectSlug="docs" projectName="Docs" onNavigate={vi.fn()} onDismiss={vi.fn()} />
	);
}

// Captured at module load so the afterAll restore puts back jsdom's originals.
const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
	// jsdom implements none of <dialog>'s methods.
	HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
	HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
	vi.useFakeTimers();
	get.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

// Restored once: testing-library unmounts in its own afterEach, and Dialog calls
// close() on unmount.
afterAll(() => {
	HTMLDialogElement.prototype.showModal = realShowModal;
	HTMLDialogElement.prototype.close = realClose;
});

describe('SyncProgressDialog before the sync status is written', () => {
	it('keeps polling through a null status and follows pending to completed', async () => {
		get
			.mockResolvedValueOnce(status(null))
			.mockResolvedValueOnce(status('pending'))
			.mockResolvedValueOnce(status('completed'));
		const { queryByText } = renderDialog();

		await vi.advanceTimersByTimeAsync(0);
		expect(get).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenLastCalledWith(STATUS_URL, expect.anything());
		expect(queryByText('Syncing repository...')).not.toBeNull();

		await vi.advanceTimersByTimeAsync(3000);
		expect(get).toHaveBeenCalledTimes(2);
		expect(queryByText('Syncing repository...')).not.toBeNull();

		await vi.advanceTimersByTimeAsync(3000);
		expect(get).toHaveBeenCalledTimes(3);
		expect(queryByText('Sync complete')).not.toBeNull();
		expect(queryByText('Syncing repository...')).toBeNull();

		await vi.advanceTimersByTimeAsync(30_000);
		expect(get).toHaveBeenCalledTimes(3);
	});

	it('shows a failure the server writes after a few null polls', async () => {
		get
			.mockResolvedValueOnce(status(null))
			.mockResolvedValueOnce(status(null))
			.mockResolvedValueOnce(status('failed', 'GitHub not connected'));
		const { queryByText } = renderDialog();

		await vi.advanceTimersByTimeAsync(6000);

		expect(queryByText('Sync failed')).not.toBeNull();
		expect(queryByText('GitHub not connected')).not.toBeNull();
	});

	it('gives up with a "never started" failure once the start deadline passes', async () => {
		get.mockResolvedValue(status(null));
		const { queryByText } = renderDialog();

		await vi.advanceTimersByTimeAsync(27_000);
		expect(queryByText('Syncing repository...')).not.toBeNull();
		expect(queryByText('Sync failed')).toBeNull();

		await vi.advanceTimersByTimeAsync(3000);
		expect(queryByText('Sync failed')).not.toBeNull();
		expect(queryByText('The repository sync never started. Retry to start it again.')).not.toBeNull();
		expect(queryByText('Retry Sync')).not.toBeNull();

		const calls = get.mock.calls.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(get).toHaveBeenCalledTimes(calls);
	});
});
