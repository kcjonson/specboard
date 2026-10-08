/**
 * Renaming from the header submits once: Enter closes the input, and the blur that
 * follows mustn't send the same rename again.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { EditorHeader } from './EditorHeader';

describe('EditorHeader rename', () => {
	it('renames once on Enter, blur or no blur', async () => {
		vi.useFakeTimers();
		try {
			const onRename = vi.fn();
			const { getByRole } = render(<EditorHeader title="spec.md" filePath="/docs/spec.md" isDirty={false} onRename={onRename} />);

			fireEvent.click(getByRole('button', { name: 'Rename file' }));
			const input = getByRole('textbox', { name: 'Rename file' });
			fireEvent.input(input, { target: { value: 'renamed.md' } });
			fireEvent.keyDown(input, { key: 'Enter' });
			fireEvent.blur(input);
			vi.advanceTimersByTime(300);

			expect(onRename).toHaveBeenCalledTimes(1);
			expect(onRename).toHaveBeenCalledWith('renamed.md');
		} finally {
			vi.useRealTimers();
		}
	});
});
