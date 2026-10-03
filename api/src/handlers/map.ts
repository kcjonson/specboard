/**
 * The Map's whole-project read (docs/specs/ai-development-overview.md, Data): every item
 * at any depth in one response, in the column form MapReadWire describes.
 */

import type { Context } from 'hono';
import { getProjectMap } from '@specboard/db';
import { encodeMapRead } from '@specboard/core/map-read';
import { requireResolvedProject } from './items.ts';

/** GET /map — `agentSessionSecret` keys the workers' session keys. */
export async function handleGetMap(context: Context, agentSessionSecret: string): Promise<Response> {
	const { id: projectId, key: projectKey } = requireResolvedProject(context);

	try {
		const read = await getProjectMap(projectId, agentSessionSecret);
		return context.json(encodeMapRead(read, projectKey));
	} catch (error) {
		console.error('Failed to read the map:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
