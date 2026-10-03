/**
 * Project-scoped planning routes (items, the Map, specs, blockers, checklist, activity
 * log), every one behind requireProjectAccess. They live together, apart from the rest
 * of the route table, so a test can mount exactly what production mounts and check
 * that every planning read answers a stranger the same way.
 */

import type { Context, Hono } from 'hono';
import { compress } from 'hono/compress';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import { resolveProject, type ResolvedProject } from '@specboard/db';
import { readProjectAddress } from './project-address.ts';
import {
	handleListItems,
	handleGetItem,
	handleGetCurrentWork,
	handleCreateItem,
	handleCreateChildren,
	handleUpdateItem,
	handleMoveItem,
	handleDeleteItem,
	handleStartItem,
	handleCompleteItem,
	handleBlockItem,
	handleUnblockItem,
} from './handlers/items.ts';
import { handleGetMap } from './handlers/map.ts';
import {
	handleListSpecs,
	handleAddSpec,
	handleDeleteSpec,
} from './handlers/specs.ts';
import {
	handleListBlockers,
	handleAddBlocker,
	handleClearBlocker,
} from './handlers/blockers.ts';
import {
	handleListChecklist,
	handleAddChecklistEntry,
	handleUpdateChecklistEntry,
	handleDeleteChecklistEntry,
} from './handlers/checklist.ts';
import {
	handleListItemNotes,
	handleAddItemNote,
} from './handlers/notes.ts';

// Context variables for request tracking
export type AppVariables = {
	userId: string | undefined;
	/**
	 * Set by requireProjectAccess once :owner/:project has been resolved and authorized.
	 * Optional because it is absent on every route that wrapper does not cover —
	 * handlers reach it through requireResolvedProject(), which fails loudly rather
	 * than letting an unwrapped route read undefined as if it were authorized.
	 */
	project?: ResolvedProject;
};

export interface PlanningRouteDeps {
	redis: Redis;
}

export function registerPlanningRoutes(app: Hono<{ Variables: AppVariables }>, { redis }: PlanningRouteDeps): void {
	// Authorization gate for project-scoped planning routes (items, specs, notes).
	// These handlers query by the resolved project alone, so without this wrapper
	// they are unauthenticated/IDOR-able. Require a valid session AND that the user owns the
	// project before the handler runs, then hand the handler the resolved project (its internal
	// id and item-key prefix) via context. 404 (not 403) on no-access so we don't disclose
	// which projects exist in other accounts.
	function requireProjectAccess(
		handler: (context: Context) => Promise<Response>
	): (context: Context) => Promise<Response> {
		return async (context) => {
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
			const userId = session?.userId ?? null;
			if (!userId) {
				return context.json({ error: 'Unauthorized' }, 401);
			}

			const project = await resolveProject(address.owner, address.project, userId);
			if (!project) {
				return context.json({ error: 'Project not found' }, 404);
			}

			context.set('project', project);
			// Handlers that record provenance (item create, blockers) read this as the actor.
			context.set('userId', userId);
			return handler(context);
		};
	}

	// Project-scoped item routes (/current before /:itemKey so it isn't captured as a key)
	app.get('/api/projects/:owner/:project/items', requireProjectAccess(handleListItems));
	app.get('/api/projects/:owner/:project/items/current', requireProjectAccess(handleGetCurrentWork));
	app.get('/api/projects/:owner/:project/items/:itemKey', requireProjectAccess(handleGetItem));
	app.post('/api/projects/:owner/:project/items', requireProjectAccess(handleCreateItem));
	app.post('/api/projects/:owner/:project/items/:itemKey/children', requireProjectAccess(handleCreateChildren));
	app.put('/api/projects/:owner/:project/items/:itemKey', requireProjectAccess(handleUpdateItem));
	app.delete('/api/projects/:owner/:project/items/:itemKey', requireProjectAccess(handleDeleteItem));
	app.post('/api/projects/:owner/:project/items/:itemKey/move', requireProjectAccess(handleMoveItem));
	app.post('/api/projects/:owner/:project/items/:itemKey/start', requireProjectAccess(handleStartItem));
	app.post('/api/projects/:owner/:project/items/:itemKey/complete', requireProjectAccess(handleCompleteItem));
	app.post('/api/projects/:owner/:project/items/:itemKey/block', requireProjectAccess(handleBlockItem));
	app.post('/api/projects/:owner/:project/items/:itemKey/unblock', requireProjectAccess(handleUnblockItem));

	// The Map's whole-project read. The ALB doesn't compress, and the payload budget
	// (docs/specs/ai-development-overview.md, Data) is a gzipped one.
	app.get('/api/projects/:owner/:project/map', compress(), requireProjectAccess(handleGetMap));

	// Project-scoped spec link routes
	app.get('/api/projects/:owner/:project/items/:itemKey/specs', requireProjectAccess(handleListSpecs));
	app.post('/api/projects/:owner/:project/items/:itemKey/specs', requireProjectAccess(handleAddSpec));
	app.delete('/api/projects/:owner/:project/items/:itemKey/specs/:id', requireProjectAccess(handleDeleteSpec));

	// Project-scoped blocker routes
	app.get('/api/projects/:owner/:project/items/:itemKey/blockers', requireProjectAccess(handleListBlockers));
	app.post('/api/projects/:owner/:project/items/:itemKey/blockers', requireProjectAccess(handleAddBlocker));
	app.delete('/api/projects/:owner/:project/items/:itemKey/blockers/:id', requireProjectAccess(handleClearBlocker));

	// Project-scoped checklist routes (scratch todos, not child items)
	app.get('/api/projects/:owner/:project/items/:itemKey/checklist', requireProjectAccess(handleListChecklist));
	app.post('/api/projects/:owner/:project/items/:itemKey/checklist', requireProjectAccess(handleAddChecklistEntry));
	app.put('/api/projects/:owner/:project/items/:itemKey/checklist/:id', requireProjectAccess(handleUpdateChecklistEntry));
	app.delete('/api/projects/:owner/:project/items/:itemKey/checklist/:id', requireProjectAccess(handleDeleteChecklistEntry));

	// Project-scoped item activity-log routes
	app.get('/api/projects/:owner/:project/items/:itemKey/notes', requireProjectAccess(handleListItemNotes));
	app.post('/api/projects/:owner/:project/items/:itemKey/notes', requireProjectAccess(handleAddItemNote));
}
