/**
 * Avatar: the person's picture when there is one, their initials when there isn't or it
 * won't load.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { Avatar, initials } from './Avatar';

describe('initials', () => {
	it.each([
		['Dana Cho', 'DC'],
		['alex', 'A'],
		['Mary Ann Smith', 'MS'],
		['  jo   lee  ', 'JL'],
		['', '?'],
		['   ', '?'],
	])('%j is %s', (name, expected) => {
		expect(initials(name)).toBe(expected);
	});
});

describe('Avatar', () => {
	it('shows initials when there is no picture', () => {
		const { getByRole } = render(<Avatar name="Dana Cho" />);

		const avatar = getByRole('img', { name: 'Dana Cho' });
		expect(avatar.textContent).toBe('DC');
		expect(avatar.querySelector('img')).toBeNull();
	});

	it('shows the picture when there is one', () => {
		const { getByRole } = render(<Avatar name="Dana Cho" avatarUrl="https://example.com/dana.png" />);

		const image = getByRole('img', { name: 'Dana Cho' }).querySelector('img');
		expect(image?.getAttribute('src')).toBe('https://example.com/dana.png');
	});

	it('falls back to initials when the picture fails to load', () => {
		const { getByRole } = render(<Avatar name="Dana Cho" avatarUrl="https://example.com/gone.png" />);
		const avatar = getByRole('img', { name: 'Dana Cho' });

		fireEvent.error(avatar.querySelector('img')!);

		expect(avatar.querySelector('img')).toBeNull();
		expect(avatar.textContent).toBe('DC');
	});

	it('tries a new picture after the old one failed', () => {
		const { getByRole, rerender } = render(<Avatar name="Dana Cho" avatarUrl="https://example.com/gone.png" />);
		fireEvent.error(getByRole('img', { name: 'Dana Cho' }).querySelector('img')!);

		rerender(<Avatar name="Dana Cho" avatarUrl="https://example.com/new.png" />);

		expect(getByRole('img', { name: 'Dana Cho' }).querySelector('img')?.getAttribute('src')).toBe('https://example.com/new.png');
	});

	it('stays out of the accessibility tree when decorative', () => {
		const { container, queryByRole } = render(<Avatar name="Dana Cho" decorative />);

		expect(queryByRole('img')).toBeNull();
		expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
	});
});
