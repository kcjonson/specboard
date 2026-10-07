/**
 * Project-scoped planning routes (items, the Map and its last-visit baseline, specs, blockers, checklist, activity
 * log), every one behind requireProjectAccess. They live together, apart from the rest
 * of the route table, so a test can mount exactly what production mounts and check
 * that every planning read answers a stranger the same way.
 */

import type { Hono } from 'hono';
import { compress } from 'hono/compress';
import type { Redis } from 'ioredis';
import { projectAccessGate, type AppVariables } from './project-access.ts';
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
import { handleGetMap, handleGetMapChanges, handleMarkMapSeen } from './handlers/map.ts';
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

export interface PlanningRouteDeps {
	redis: Redis;
}

/**
 * Reads are viewer; writes to items, specs, blockers, the checklist and the activity log
 * are editor. Moving one's own Map baseline is per-person state, so a viewer can too.
 */
export function registerPlanningRoutes(app: Hono<{ Variables: AppVariables }>, { redis }: PlanningRouteDeps): void {
	const requireProjectAccess = projectAccessGate(redis);
	const viewer = requireProjectAccess('viewer');
	const editor = requireProjectAccess('editor');

	// Project-scoped item routes (/current before /:itemKey so it isn't captured as a key)
	app.get('/api/projects/:owner/:project/items', viewer, handleListItems);
	app.get('/api/projects/:owner/:project/items/current', viewer, handleGetCurrentWork);
	app.get('/api/projects/:owner/:project/items/:itemKey', viewer, handleGetItem);
	app.post('/api/projects/:owner/:project/items', editor, handleCreateItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/children', editor, handleCreateChildren);
	app.put('/api/projects/:owner/:project/items/:itemKey', editor, handleUpdateItem);
	app.delete('/api/projects/:owner/:project/items/:itemKey', editor, handleDeleteItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/move', editor, handleMoveItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/start', editor, handleStartItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/complete', editor, handleCompleteItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/block', editor, handleBlockItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/unblock', editor, handleUnblockItem);

	// The Map's whole-project read. The ALB doesn't compress, and the payload budget
	// (docs/specs/ai-development-overview.md, Data) is a gzipped one.
	app.get('/api/projects/:owner/:project/map', compress(), viewer, handleGetMap);

	// Since your last visit: the person's baseline with what changed since it, and the move
	// forward of the baseline. A request of its own, so the Map read is the same for everyone.
	app.get('/api/projects/:owner/:project/map/changes', compress(), viewer, handleGetMapChanges);
	app.post('/api/projects/:owner/:project/map/seen', viewer, handleMarkMapSeen);

	// Project-scoped spec link routes
	app.get('/api/projects/:owner/:project/items/:itemKey/specs', viewer, handleListSpecs);
	app.post('/api/projects/:owner/:project/items/:itemKey/specs', editor, handleAddSpec);
	app.delete('/api/projects/:owner/:project/items/:itemKey/specs/:id', editor, handleDeleteSpec);

	// Project-scoped blocker routes
	app.get('/api/projects/:owner/:project/items/:itemKey/blockers', viewer, handleListBlockers);
	app.post('/api/projects/:owner/:project/items/:itemKey/blockers', editor, handleAddBlocker);
	app.delete('/api/projects/:owner/:project/items/:itemKey/blockers/:id', editor, handleClearBlocker);

	// Project-scoped checklist routes (scratch todos, not child items)
	app.get('/api/projects/:owner/:project/items/:itemKey/checklist', viewer, handleListChecklist);
	app.post('/api/projects/:owner/:project/items/:itemKey/checklist', editor, handleAddChecklistEntry);
	app.put('/api/projects/:owner/:project/items/:itemKey/checklist/:id', editor, handleUpdateChecklistEntry);
	app.delete('/api/projects/:owner/:project/items/:itemKey/checklist/:id', editor, handleDeleteChecklistEntry);

	// Project-scoped item activity-log routes
	app.get('/api/projects/:owner/:project/items/:itemKey/notes', viewer, handleListItemNotes);
	app.post('/api/projects/:owner/:project/items/:itemKey/notes', editor, handleAddItemNote);
}
