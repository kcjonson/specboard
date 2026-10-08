/**
 * A commit refused because the branch moved offers a pull, since retrying would only
 * fail again; any other failure offers a retry.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { CommitErrorBanner } from './CommitErrorBanner';

describe('CommitErrorBanner', () => {
	it('offers Pull for a refused commit', () => {
		const onRetry = vi.fn();
		const onPull = vi.fn();
		const { getByRole } = render(
			<CommitErrorBanner
				error={{ stage: 'commit', message: 'Pull first, then commit again.', conflictDetected: true }}
				onRetry={onRetry}
				onPull={onPull}
				onDismiss={vi.fn()}
			/>
		);

		fireEvent.click(getByRole('button', { name: 'Pull' }));

		expect(onPull).toHaveBeenCalled();
		expect(onRetry).not.toHaveBeenCalled();
	});

	it('offers Try Again for any other failure', () => {
		const onRetry = vi.fn();
		const { getByRole } = render(
			<CommitErrorBanner
				error={{ stage: 'commit', message: 'GitHub API error: 502 Bad Gateway' }}
				onRetry={onRetry}
				onPull={vi.fn()}
				onDismiss={vi.fn()}
			/>
		);

		fireEvent.click(getByRole('button', { name: 'Try Again' }));

		expect(onRetry).toHaveBeenCalled();
	});
});
