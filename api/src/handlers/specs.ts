/**
 * Spec link handlers — typed spec document links on work items.
 */

import type { Context } from 'hono';
import {
	listSpecsByEpic,
	addSpec,
	removeSpec,
	validateSpecInput,
	verifyEpicOwnership,
	SpecConflictError,
	SpecValidationError,
} from '@specboard/db';
import type { SpecSummary } from '@specboard/db';
import type { ApiSpec } from '../types.ts';
import { isValidUUID } from '../validation.ts';

function toApi(spec: SpecSummary, epicId: string, projectId: string): ApiSpec {
	return {
		id: spec.id,
		epicId,
		projectId,
		path: spec.path,
		type: spec.type,
		createdAt: spec.createdAt.toISOString(),
	};
}

export async function handleListSpecs(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const epicId = context.req.param('epicId');

	if (!isValidUUID(projectId) || !isValidUUID(epicId)) {
		return context.json({ error: 'Invalid ID format' }, 400);
	}

	try {
		if (!(await verifyEpicOwnership(projectId, epicId))) {
			return context.json({ error: 'Epic not found' }, 404);
		}
		const specs = await listSpecsByEpic(projectId, epicId);
		return context.json(specs.map((s) => toApi(s, epicId, projectId)));
	} catch (error) {
		console.error('Failed to list specs:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleAddSpec(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const epicId = context.req.param('epicId');

	if (!isValidUUID(projectId) || !isValidUUID(epicId)) {
		return context.json({ error: 'Invalid ID format' }, 400);
	}

	const body = await context.req.json<{ path?: unknown; type?: unknown }>();

	try {
		const { path, type } = validateSpecInput(body.path, body.type);
		const spec = await addSpec(projectId, epicId, path, type);
		if (!spec) {
			return context.json({ error: 'Epic not found' }, 404);
		}
		return context.json(toApi(spec, epicId, projectId), 201);
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
	const projectId = context.req.param('projectId');
	const epicId = context.req.param('epicId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId) || !isValidUUID(epicId) || !isValidUUID(id)) {
		return context.json({ error: 'Invalid ID format' }, 400);
	}

	try {
		const deleted = await removeSpec(projectId, epicId, id);
		if (!deleted) {
			return context.json({ error: 'Spec not found' }, 404);
		}
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete spec:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
