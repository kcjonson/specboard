import { describe, it, expect } from 'vitest';
import { projectBanner } from './project-banner';

const REPOSITORY = {
	type: 'cloud' as const,
	remote: { provider: 'github' as const, owner: 'acme-corp', repo: 'roadmap', url: 'https://github.com/acme-corp/roadmap' },
	branch: 'main',
};

describe('projectBanner', () => {
	it('tells a granted viewer whom to ask', () => {
		expect(projectBanner('viewer', { ownerName: 'Alice Ames' })).toEqual({
			variant: 'info',
			message: 'You have view access. Ask Alice Ames for edit access.',
		});
	});

	it('falls back to "the project owner" before the owner\'s name is known', () => {
		expect(projectBanner('viewer', {})?.message).toBe('You have view access. Ask the project owner for edit access.');
	});

	it('offers an editor without GitHub the connection', () => {
		expect(projectBanner('github_not_connected', { ownerName: 'Alice Ames' })).toEqual({
			variant: 'info',
			message: 'Connect GitHub to start editing.',
			action: 'connect_github',
		});
	});

	it('warns about push access, naming the account and the repository', () => {
		expect(projectBanner('no_push_access', { repository: REPOSITORY, githubUsername: 'vera' })).toEqual({
			variant: 'warning',
			message: "Your GitHub account @vera can't push to acme-corp/roadmap. Ask the repo owner to add you.",
		});
	});

	it('still warns while the GitHub account name is loading', () => {
		expect(projectBanner('no_push_access', { repository: REPOSITORY, githubUsername: null })?.message).toBe(
			"Your GitHub account can't push to acme-corp/roadmap. Ask the repo owner to add you."
		);
	});

	it('shows nothing for someone who can edit', () => {
		expect(projectBanner(null, { ownerName: 'Alice Ames' })).toBeNull();
	});
});
