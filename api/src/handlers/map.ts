/**
 * The Map's project read (docs/specs/ai-development-overview.md, Data): every item at any
 * depth in one response, or with `?since=<cursor>` only what changed after an earlier
 * read, in the column form MapReadWire describes.
 */

import type { Context } from 'hono';
import { getProjectMap } from '@specboard/db';
import { encodeMapRead } from '@specboard/core/map-read';
import { requireResolvedProject } from './items.ts';

/** GET /map */
export async function handleGetMap(context: Context): Promise<Response> {
	const { id: projectId, key: projectKey } = requireResolvedProject(context);

	const sinceParam = context.req.query('since');
	const since = sinceParam === undefined ? null : Number(sinceParam);
	if (since !== null && (!/^\d+$/.test(sinceParam!) || !Number.isSafeInteger(since))) {
		return context.json({ error: 'since must be the cursor of an earlier map read' }, 400);
	}

	try {
		const read = await getProjectMap(projectId, since);
		return context.json(encodeMapRead(read, projectKey));
	} catch (error) {
		console.error('Failed to read the map:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
