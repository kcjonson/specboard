/**
 * A conflicting draft is marked with a glyph and a spoken label, not only a color.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { FileStatus } from './FileStatus';

describe('FileStatus', () => {
	it('labels an ordinary change', () => {
		const { getByRole } = render(<FileStatus status="modified" />);

		expect(getByRole('img', { name: 'File modified' })).toBeTruthy();
	});

	it('marks a conflict with an alert glyph and says what it means', () => {
		const { getByRole } = render(<FileStatus status="modified" conflict />);

		const mark = getByRole('img', { name: 'File modified, and someone else changed it since your draft began' });
		expect(mark.querySelector('svg')).toBeTruthy();
	});
});
