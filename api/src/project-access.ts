/**
 * The authorization boundary for every project-scoped route.
 *
 * Each route under `/api/projects/:owner/:project/...` is registered behind
 * requireProjectAccess(minRole). It resolves the address with resolveProjectAccess, the
 * one resolver REST and MCP share, and refuses before the handler runs:
 *
 * - malformed address: 400
 * - no session: 401
 * - not the owner and not a member (or no such project): 404, never 403, so other
 *   users' projects can't be probed
 * - a member below minRole: 403 naming the reason (viewer, github_not_connected,
 *   owner_only)
 *
 * Handlers then read the authorized project and role off the context and make no
 * access decision of their own.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import {
	accessDenial,
	ACCESS_DENIAL_MESSAGES,
	getProject,
	resolveProjectAccess,
	type ProjectAccess,
	type ProjectResponse,
	type ProjectRole,
	type ResolvedProject,
} from '@specboard/db';
import { isValidProjectSlug, isValidUserSlug } from '@specboard/core/identifiers';

/** Context variables every route in the app can see. */
export type AppVariables = {
	userId: string | undefined;
	/**
	 * Set by requireProjectAccess once :owner/:project has been resolved and authorized.
	 * Optional because they are absent on every route the gate does not cover; handlers
	 * reach them through requireAccess() and requireResolvedProject(), which fail loudly
	 * rather than letting an ungated route read undefined as if it were authorized.
	 */
	access?: ProjectAccess;
	project?: ResolvedProject;
};

export interface ProjectAddress {
	owner: string;
	project: string;
}

/** The :owner/:project path params, or null when either half is malformed. */
export function readProjectAddress(context: Context): ProjectAddress | null {
	const owner = context.req.param('owner');
	const project = context.req.param('project');
	return isValidUserSlug(owner) && isValidProjectSlug(project) ? { owner, project } : null;
}

const declaredMinRoles = new WeakMap<object, ProjectRole>();

/**
 * The minimum role a gate created by requireProjectAccess enforces, or undefined for
 * any other handler. The role-matrix suite reads it off the registered route table, so
 * a project route registered without a gate fails the suite.
 */
export function declaredMinRole(handler: unknown): ProjectRole | undefined {
	return typeof handler === 'function' ? declaredMinRoles.get(handler) : undefined;
}

type ProjectGate = MiddlewareHandler<{ Variables: AppVariables }>;

/** requireProjectAccess, bound to the session store. */
export function projectAccessGate(redis: Redis): (minRole: ProjectRole) => ProjectGate {
	return (minRole) => {
		const gate: ProjectGate = async (context, next) => {
			const address = readProjectAddress(context);
			if (!address) {
				return context.json({ error: 'Invalid project address' }, 400);
			}

			const sessionId = getCookie(context, SESSION_COOKIE_NAME);
			// Redis outage means the session can't be verified: 401, not a 500
			const session = sessionId
				? await getSession(redis, sessionId).catch((error: unknown) => {
					console.error('Project access session lookup error:', error instanceof Error ? error.message : error);
					return null;
				})
				: null;
			const userId = session?.userId;
			if (!userId) {
				return context.json({ error: 'Unauthorized' }, 401);
			}

			const access = await resolveProjectAccess(address.owner, address.project, userId);
			if (!access) {
				return context.json({ error: 'Project not found' }, 404);
			}

			const denial = accessDenial(access, minRole);
			if (denial) {
				return context.json({ error: ACCESS_DENIAL_MESSAGES[denial], reason: denial }, 403);
			}

			context.set('access', access);
			context.set('project', access.project);
			// Handlers that record provenance (item create, blockers) read this as the actor.
			context.set('userId', userId);
			await next();
		};
		declaredMinRoles.set(gate, minRole);
		return gate;
	};
}

const MISSING_GATE = 'Route is missing requireProjectAccess';

/**
 * The caller's authorized access to the route's project.
 *
 * Throws rather than returning undefined: reaching here without it means the route
 * was registered without the gate, which would otherwise read as "authorized". A 500
 * is the correct answer to that mistake.
 */
export function requireAccess(context: Context): ProjectAccess {
	const access = context.get('access') as ProjectAccess | undefined;
	if (!access) throw new Error(`${MISSING_GATE}: no access on context`);
	return access;
}

/** The project resolved from :owner/:project by requireProjectAccess. */
export function requireResolvedProject(context: Context): ResolvedProject {
	const project = context.get('project') as ResolvedProject | undefined;
	if (!project) throw new Error(`${MISSING_GATE}: no resolved project on context`);
	return project;
}

/**
 * The signed-in user's id. The logging middleware sets it on every request, so finding
 * it proves a session, not that the gate ran; requireAccess is the check for that.
 */
export function apiUserId(context: Context): string {
	const userId = context.get('userId') as string | undefined;
	if (!userId) throw new Error(`${MISSING_GATE}: no userId on context`);
	return userId;
}

/** The full project behind the authorized address, for handlers that need more than its id. */
export function loadAuthorizedProject(context: Context): Promise<ProjectResponse | null> {
	return getProject(requireResolvedProject(context).id);
}
