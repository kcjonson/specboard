/**
 * StatusGlyph - accessible name and the blocked override
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { StatusGlyph } from './StatusGlyph';

describe('StatusGlyph', () => {
	it('names the status for assistive tech', () => {
		const { getByRole } = render(<StatusGlyph status="in_review" />);

		expect(getByRole('img', { name: 'In Review' })).toBeTruthy();
	});

	it('names Blocked when the derived flag is set, whatever the status', () => {
		const { getByRole } = render(<StatusGlyph status="ready" blocked />);

		expect(getByRole('img', { name: 'Blocked' })).toBeTruthy();
	});

	it('hides itself when the status is written out beside it', () => {
		const { container, queryByRole } = render(<StatusGlyph status="done" decorative />);

		expect(queryByRole('img')).toBeNull();
		expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
	});
});
