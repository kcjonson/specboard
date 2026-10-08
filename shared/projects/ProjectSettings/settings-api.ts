/**
 * What the settings page reads and writes, in the shapes the API answers with
 * (docs/specs/api-database.md, Project Members and Project Invitations).
 */

import { fetchClient } from '@specboard/fetch';
import type { ModelData, ProjectModel, ProjectRole } from '@specboard/models';

export type MemberRole = 'editor' | 'viewer';

/** A row of GET /api/projects/:owner/:project/members. */
export interface Member {
	/** How the API addresses them; null only before onboarding, which members never are. */
	slug: string | null;
	name: string;
	email: string;
	avatarUrl: string | null;
	/** The granted role; owner for the owner's row. */
	role: ProjectRole;
	effectiveRole: ProjectRole;
	githubConnected: boolean;
	/** For the owner's view only; null for everyone else, and when unknown. */
	pushAccess: boolean | null;
}

/** A row of the owner's pending list, open or expired. */
export interface PendingInvitation {
	id: string;
	email: string;
	role: MemberRole;
	invitedBy: string;
	createdAt: string;
	expiresAt: string;
	state: 'open' | 'expired';
}

export const ROLE_LABELS: Record<ProjectRole, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

const DAY_MS = 24 * 60 * 60 * 1000;

/** "expires in 5 days", or "expired". */
export function expiryText(invitation: Pick<PendingInvitation, 'state' | 'expiresAt'>, now: number = Date.now()): string {
	const left = Date.parse(invitation.expiresAt) - now;
	if (invitation.state === 'expired' || !(left > 0)) return 'expired';
	const days = Math.ceil(left / DAY_MS);
	return `expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * PUT the project and fold the answer into the page's shared model, so the header and
 * every other reader see the change. The server leaves an unset description or prompt
 * out of its answer, so those are cleared explicitly rather than left at the old value.
 */
export async function saveProject(project: ProjectModel, projectRef: string, body: Record<string, unknown>): Promise<void> {
	const updated = await fetchClient.put<Partial<ModelData<ProjectModel>>>(`/api/projects/${projectRef}`, body);
	project.set({ description: undefined, systemPrompt: undefined, ...updated });
}
