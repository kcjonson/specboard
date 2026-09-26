/**
 * adminOnly: in-app navigation into admin routes re-checks the role
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/preact';
import { navigate, startRouter, type RouteProps } from '@specboard/router';

vi.mock('@specboard/fetch', () => ({
	fetchClient: { get: vi.fn() },
}));

import { fetchClient } from '@specboard/fetch';
import { adminOnly } from './admin-only';

const get = vi.mocked(fetchClient.get);

function me(roles: string[]): Promise<unknown> {
	return Promise.resolve({ id: 'u1', roles });
}

let container: HTMLElement;
let stop: () => void;

function start(path: string): void {
	window.history.replaceState(null, '', window.location.origin + path);
	container = document.createElement('div');
	stop = startRouter(
		[
			{ route: '/admin', entry: adminOnly(() => <p>admin home</p>) },
			{ route: '/admin/users/:userId', entry: adminOnly(({ params }: RouteProps) => <p>admin user {params.userId}</p>) },
			{ route: '/projects', entry: () => <p>projects</p> },
		],
		container,
		() => <p>unknown route</p>
	);
}

function showsNotFound(): boolean {
	return container.querySelector('.not-found-container') !== null;
}

beforeEach(() => {
	get.mockReset();
});

afterEach(() => {
	stop();
});

describe('adminOnly', () => {
	it('renders the page for an admin, asking the API for the current user', async () => {
		get.mockReturnValue(me(['admin']));
		start('/admin');

		await waitFor(() => expect(container.textContent).toBe('admin home'));
		expect(get).toHaveBeenCalledExactlyOnceWith('/api/users/me');
	});

	it('renders NotFound for a non-admin', async () => {
		get.mockReturnValue(me([]));
		start('/admin');

		await waitFor(() => expect(showsNotFound()).toBe(true));
		expect(container.textContent).not.toContain('admin home');
	});

	it('renders NotFound when the check fails', async () => {
		get.mockRejectedValue(new Error('Network error'));
		start('/admin');

		await waitFor(() => expect(showsNotFound()).toBe(true));
		expect(container.textContent).not.toContain('admin home');
	});

	it('renders only a neutral loading state while the check is pending', async () => {
		get.mockReturnValue(new Promise(() => {}));
		start('/admin');

		await waitFor(() => expect(get).toHaveBeenCalledOnce());
		expect(container.textContent).toBe('Loading...');
	});

	it('picks up a revoke on the next navigation, even within the same route', async () => {
		get.mockReturnValue(me(['admin']));
		start('/admin/users/u1');
		await waitFor(() => expect(container.textContent).toBe('admin user u1'));

		get.mockReturnValue(me([]));
		navigate('/admin/users/u2');

		await waitFor(() => expect(showsNotFound()).toBe(true));
		expect(get).toHaveBeenCalledTimes(2);
	});

	it('picks up a grant on the next navigation', async () => {
		get.mockReturnValue(me([]));
		start('/admin');
		await waitFor(() => expect(showsNotFound()).toBe(true));

		get.mockReturnValue(me(['admin']));
		navigate('/projects');
		navigate('/admin');

		await waitFor(() => expect(container.textContent).toBe('admin home'));
	});

	it('re-checks between two URLs of the same route without showing the next page first', async () => {
		get.mockReturnValue(me(['admin']));
		start('/admin/users/u1');
		await waitFor(() => expect(container.textContent).toBe('admin user u1'));

		get.mockReturnValue(new Promise(() => {}));
		navigate('/admin/users/u2');

		expect(container.textContent).toBe('Loading...');
		await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
		expect(container.textContent).toBe('Loading...');
	});
});
