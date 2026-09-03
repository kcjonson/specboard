/**
 * Blocker handlers — polymorphic blocked-by rows on items.
 *
 * A blocker is exactly one of: another item in the project ({ blockerKey }) or
 * free text ({ text }). DELETE clears (tombstones) a blocker; only item
 * deletion removes rows (FK cascade).
 */

import type { Context } from 'hono';
import {
	listBlockers,
	addBlocker,
	clearBlocker,
	verifyItemOwnership,
	BlockerValidationError,
	BlockerConflictError,
	BlockerTargetError,
} from '@specboard/db';
import type { ResolvedProject } from '@specboard/db';
import { requireResolvedProject, apiActor } from './items.ts';
import { itemNumberInProject, parseItemKey } from '@specboard/core/identifiers';
import { apiBlocker } from '../types.ts';
import { isValidUUID } from '../validation.ts';

function resolve(context: Context): { project: ResolvedProject; itemNumber: number } | Response {
	const project = requireResolvedProject(context);
	const itemKey = context.req.param('itemKey');
	if (!itemKey || !parseItemKey(itemKey)) return context.json({ error: 'Invalid item key' }, 400);

	const itemNumber = itemNumberInProject(itemKey, project.key);
	if (itemNumber === null) return context.json({ error: 'Item not found' }, 404);
	return { project, itemNumber };
}

export async function handleListBlockers(context: Context): Promise<Response> {
	const resolved = resolve(context);
	if (resolved instanceof Response) return resolved;
	const { project, itemNumber } = resolved;

	const includeCleared = context.req.query('includeCleared') === 'true';
	try {
		const blockers = await listBlockers(project.id, itemNumber, { includeCleared });
		if (!blockers) return context.json({ error: 'Item not found' }, 404);
		return context.json(blockers.map(apiBlocker));
	} catch (error) {
		console.error('Failed to list blockers:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleAddBlocker(context: Context): Promise<Response> {
	const resolved = resolve(context);
	if (resolved instanceof Response) return resolved;
	const { project, itemNumber } = resolved;

	const body = await context.req.json<{ blockerKey?: unknown; text?: unknown }>();

	try {
		let input: { itemNumber: number } | { text: string };
		if (body.blockerKey !== undefined && body.blockerKey !== null) {
			if (body.text !== undefined && body.text !== null) {
				return context.json({ error: 'A blocker is exactly one of: blockerKey, or text' }, 400);
			}
			if (typeof body.blockerKey !== 'string' || !parseItemKey(body.blockerKey)) {
				return context.json({ error: 'Invalid blockerKey' }, 400);
			}
			const blockerNumber = itemNumberInProject(body.blockerKey, project.key);
			if (blockerNumber === null) return context.json({ error: 'Blocker item not found' }, 404);
			input = { itemNumber: blockerNumber };
		} else if (typeof body.text === 'string' && body.text.trim().length > 0) {
			input = { text: body.text.trim() };
		} else {
			return context.json({ error: 'A blocker is exactly one of: blockerKey, or text' }, 400);
		}

		const blocker = await addBlocker(project.id, itemNumber, input, apiActor(context));
		if (!blocker) return context.json({ error: 'Item not found' }, 404);
		return context.json(apiBlocker(blocker), 201);
	} catch (error) {
		if (error instanceof BlockerValidationError) return context.json({ error: error.message }, 400);
		if (error instanceof BlockerTargetError) return context.json({ error: error.message }, 400);
		if (error instanceof BlockerConflictError) {
			return context.json({ error: error.message, code: 'BLOCKER_EXISTS' }, 409);
		}
		console.error('Failed to add blocker:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleClearBlocker(context: Context): Promise<Response> {
	const resolved = resolve(context);
	if (resolved instanceof Response) return resolved;
	const { project, itemNumber } = resolved;

	const id = context.req.param('id');
	if (!isValidUUID(id)) return context.json({ error: 'Invalid blocker ID format' }, 400);

	try {
		// Verify the item the way the list and add paths do, so a missing item reports
		// itself as a missing item rather than as a missing blocker.
		if (!(await verifyItemOwnership(project.id, itemNumber))) {
			return context.json({ error: 'Item not found' }, 404);
		}
		const cleared = await clearBlocker(project.id, itemNumber, id, apiActor(context));
		if (!cleared) return context.json({ error: 'Blocker not found' }, 404);
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to clear blocker:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
