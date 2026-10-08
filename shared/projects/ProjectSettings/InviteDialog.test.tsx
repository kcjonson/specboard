/**
 * The invite dialog: sends email and role, shows the server's refusals in place, and
 * says so when the repository it shares is private.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';

const get = vi.fn();
const post = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/fetch')>()),
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import { InviteDialog } from './InviteDialog';

const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;

afterAll(() => {
	HTMLDialogElement.prototype.showModal = realShowModal;
	HTMLDialogElement.prototype.close = realClose;
});

beforeEach(() => {
	HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
	HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
	get.mockReset();
	post.mockReset();
	get.mockResolvedValue([]);
});

function renderDialog(repositoryName: string | null = 'acme/roadmap', onInvited = vi.fn()): ReturnType<typeof render> & { onInvited: typeof onInvited } {
	const view = render(
		<InviteDialog projectRef="dana/roadmap" projectName="roadmap" repositoryName={repositoryName} onClose={vi.fn()} onInvited={onInvited} />
	);
	return { ...view, onInvited };
}

function fillAndSend(view: ReturnType<typeof render>, email: string, role?: 'editor' | 'viewer'): void {
	fireEvent.input(view.getByRole('textbox', { name: 'Email' }), { target: { value: email } });
	if (role) fireEvent.change(view.getByRole('combobox', { name: /Role/ }), { target: { value: role } });
	fireEvent.click(view.getByRole('button', { name: 'Send invite' }));
}

describe('InviteDialog', () => {
	it('sends the address and role, and hands back the invitation', async () => {
		const invitation = { id: 'inv-9', email: 'pat@example.com', role: 'viewer', state: 'open' };
		post.mockResolvedValue(invitation);
		const view = renderDialog();

		expect(view.getByRole('heading', { name: 'Invite to roadmap' })).toBeTruthy();
		expect(view.getByText(/Editors need their own GitHub account connected/)).toBeTruthy();
		fillAndSend(view, ' pat@example.com ', 'viewer');

		await waitFor(() => expect(post).toHaveBeenCalledWith('/api/projects/dana/roadmap/invitations', { email: 'pat@example.com', role: 'viewer' }));
		await waitFor(() => expect(view.onInvited).toHaveBeenCalledWith(invitation));
	});

	it.each([
		[409, 'Someone with that address is already a member of this project'],
		[409, "That's the project owner's address"],
		[429, 'Too many invitations. Try again later.'],
	])('shows a %i in place and keeps the form', async (status, message) => {
		post.mockRejectedValue(new FetchError(`HTTP ${status}`, status, undefined, { error: message }));
		const view = renderDialog();

		fillAndSend(view, 'alex@example.com');

		expect((await view.findByRole('alert')).textContent).toBe(message);
		expect(view.onInvited).not.toHaveBeenCalled();
		expect((view.getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value).toBe('alex@example.com');
		expect(view.getByRole('button', { name: 'Send invite' }).hasAttribute('disabled')).toBe(false);
	});

	it('notes a private repository', async () => {
		get.mockResolvedValue([{ id: 1, fullName: 'Acme/Roadmap', name: 'Roadmap', owner: 'Acme', private: true, defaultBranch: 'main', url: '' }]);
		const view = renderDialog();

		expect(await view.findByText('acme/roadmap is a private repository. Members can read its documents here.')).toBeTruthy();
		expect(get).toHaveBeenCalledWith('/api/github/repos');
	});

	it('leaves the note off for a public repository', async () => {
		get.mockResolvedValue([{ id: 1, fullName: 'acme/roadmap', name: 'roadmap', owner: 'acme', private: false, defaultBranch: 'main', url: '' }]);
		const view = renderDialog();

		await waitFor(() => expect(get).toHaveBeenCalledWith('/api/github/repos'));
		expect(view.queryByText(/is a private repository/)).toBeNull();
	});

	it("doesn't ask GitHub about a project without a repository", () => {
		renderDialog(null);
		expect(get).not.toHaveBeenCalled();
	});
});
