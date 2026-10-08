import type { ProjectRepository, ProjectRoleReason } from '@specboard/models';

export interface ProjectBannerContent {
	variant: 'info' | 'warning';
	message: string;
	/** The one thing the banner offers to do about it. */
	action?: 'connect_github';
}

export interface ProjectBannerContext {
	ownerName?: string;
	repository?: ProjectRepository;
	/** The caller's GitHub login, for the push-access warning. */
	githubUsername?: string | null;
}

/**
 * The line under the header for a read-only or warned member, by reason. "Viewer by
 * choice" and "editor waiting on GitHub" need different next steps, so each says its own.
 */
export function projectBanner(reason: ProjectRoleReason | null, context: ProjectBannerContext): ProjectBannerContent | null {
	switch (reason) {
		case 'viewer':
			return {
				variant: 'info',
				message: `You have view access. Ask ${context.ownerName || 'the project owner'} for edit access.`,
			};
		case 'github_not_connected':
			return { variant: 'info', message: 'Connect GitHub to start editing.', action: 'connect_github' };
		case 'no_push_access': {
			const account = context.githubUsername ? `Your GitHub account @${context.githubUsername}` : 'Your GitHub account';
			const remote = context.repository?.remote;
			const repo = remote ? `${remote.owner}/${remote.repo}` : 'this repository';
			return { variant: 'warning', message: `${account} can't push to ${repo}. Ask the repo owner to add you.` };
		}
		default:
			return null;
	}
}
