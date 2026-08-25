/**
 * Spec link handlers — typed spec document links on items.
 */

import type { Context } from 'hono';
import {
	listSpecsByItem,
	addSpec,
	removeSpec,
	validateSpecInput,
	verifyItemOwnership,
	SpecConflictError,
	SpecValidationError,
} from '@specboard/db';
import type { SpecSummary, ResolvedProject } from '@specboard/db';
import { requireResolvedProject } from './items.ts';
import { itemNumberInProject, parseItemKey } from '@specboard/core/identifiers';
import type { ApiSpec } from '../types.ts';
import { isValidUUID } from '../validation.ts';

function toApi(spec: SpecSummary, itemKey: string, projectSlug: string): ApiSpec {
	return {
		id: spec.id,
		itemKey,
		projectSlug,
		path: spec.path,
		type: spec.type,
		createdAt: spec.createdAt.toISOString(),
	};
}

/**
 * The project resolved from :projectSlug plus the :itemKey path segment as a
 * per-project number, or null when the key doesn't address this project.
 */
function resolve(context: Context): { project: ResolvedProject; itemKey: string; itemNumber: number } | Response {
	const project = requireResolvedProject(context);
	const itemKey = context.req.param('itemKey');
	if (!itemKey || !parseItemKey(itemKey)) return context.json({ error: 'Invalid item key' }, 400);

	const itemNumber = itemNumberInProject(itemKey, project.key);
	if (itemNumber === null) return context.json({ error: 'Item not found' }, 404);
	return { project, itemKey, itemNumber };
}

export async function handleListSpecs(context: Context): Promise<Response> {
	const resolved = resolve(context);
	if (resolved instanceof Response) return resolved;
	const { project, itemKey, itemNumber } = resolved;

	try {
		if (!(await verifyItemOwnership(project.id, itemNumber))) {
			return context.json({ error: 'Item not found' }, 404);
		}
		const specs = await listSpecsByItem(project.id, itemNumber);
		return context.json(specs.map((s) => toApi(s, itemKey, project.slug)));
	} catch (error) {
		console.error('Failed to list specs:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleAddSpec(context: Context): Promise<Response> {
	const resolved = resolve(context);
	if (resolved instanceof Response) return resolved;
	const { project, itemKey, itemNumber } = resolved;

	const body = await context.req.json<{ path?: unknown; type?: unknown }>();

	try {
		const { path, type } = validateSpecInput(body.path, body.type);
		const spec = await addSpec(project.id, itemNumber, path, type);
		if (!spec) {
			return context.json({ error: 'Item not found' }, 404);
		}
		return context.json(toApi(spec, itemKey, project.slug), 201);
	} catch (error) {
		if (error instanceof SpecValidationError) {
			return context.json({ error: error.message }, 400);
		}
		if (error instanceof SpecConflictError) {
			return context.json({ error: error.message, code: 'SPEC_EXISTS' }, 409);
		}
		console.error('Failed to add spec:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleDeleteSpec(context: Context): Promise<Response> {
	const resolved = resolve(context);
	if (resolved instanceof Response) return resolved;
	const { project, itemNumber } = resolved;

	const id = context.req.param('id');
	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid spec ID format' }, 400);
	}

	try {
		// Verify the item the way the list and add paths do, so a missing item reports
		// itself as a missing item rather than as a missing spec.
		if (!(await verifyItemOwnership(project.id, itemNumber))) {
			return context.json({ error: 'Item not found' }, 404);
		}
		const deleted = await removeSpec(project.id, itemNumber, id);
		if (!deleted) {
			return context.json({ error: 'Spec not found' }, 404);
		}
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete spec:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
