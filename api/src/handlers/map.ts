/**
 * The Map's whole-project read (docs/specs/ai-development-overview.md, Data): every item
 * at any depth in one response, in the column form MapReadWire describes. Beside it, the
 * person's last-visit baseline and the changes since (Since your last visit): the changes
 * read and the move forward of the baseline, behind the same access check.
 */

import type { Context } from 'hono';
import { advanceMapBaseline, getMapChanges, getProjectMap } from '@specboard/db';
import { encodeMapRead } from '@specboard/core/map-read';
import { encodeMapChanges } from '@specboard/core/map-changes';
import { apiUserId, requireResolvedProject } from './items.ts';

/** GET /map */
export async function handleGetMap(context: Context): Promise<Response> {
	const { id: projectId, key: projectKey } = requireResolvedProject(context);

	try {
		const read = await getProjectMap(projectId);
		return context.json(encodeMapRead(read, projectKey));
	} catch (error) {
		console.error('Failed to read the map:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** GET /map/changes: the person's baseline, the read's time, and what changed since the baseline. */
export async function handleGetMapChanges(context: Context): Promise<Response> {
	const { id: projectId, key: projectKey } = requireResolvedProject(context);

	try {
		const changes = await getMapChanges(apiUserId(context), projectId, projectKey);
		return context.json(encodeMapChanges(changes, projectKey));
	} catch (error) {
		console.error('Failed to read the map changes:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /map/seen: moves the baseline forward to the moment the person's Map had read up to. */
export async function handleMarkMapSeen(context: Context): Promise<Response> {
	const { id: projectId } = requireResolvedProject(context);

	let body: { readAt?: unknown } | null;
	try {
		body = await context.req.json<{ readAt?: unknown } | null>();
	} catch {
		return context.json({ error: 'A JSON body with readAt is required' }, 400);
	}
	if (typeof body?.readAt !== 'number' || !Number.isFinite(body.readAt) || body.readAt <= 0) {
		return context.json({ error: 'readAt must be the read time from the changes read, in epoch milliseconds' }, 400);
	}

	try {
		const baseline = await advanceMapBaseline(apiUserId(context), projectId, body.readAt);
		return context.json({ baseline });
	} catch (error) {
		console.error('Failed to move the map baseline:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
