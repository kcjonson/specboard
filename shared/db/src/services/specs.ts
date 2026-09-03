/**
 * Spec link service — typed spec links on items.
 *
 * A spec link associates an item with a markdown file path in the project's docs,
 * plus a type (product | technical). Used by both API handlers and MCP tools.
 */

import { formatItemKey } from '@specboard/core/identifiers';
import { query, transaction } from '../index.ts';
import type { ItemSpec, SpecType } from '../types.ts';
import type { SpecSummary } from './items.ts';

const SPEC_TYPES: SpecType[] = ['product', 'technical'];

/** Thrown when adding a spec link that already exists for the item (path unique per item). */
export class SpecConflictError extends Error {
	constructor(message = 'Spec is already linked to this item') {
		super(message);
		this.name = 'SpecConflictError';
	}
}

/** Thrown when a spec path or type fails validation. */
export class SpecValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SpecValidationError';
	}
}

/**
 * Validate a spec link's path and type. Throws SpecValidationError on failure.
 * Paths must be absolute (start with "/") and must not traverse ("..").
 */
export function validateSpecInput(path: unknown, type: unknown): { path: string; type: SpecType } {
	if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) {
		throw new SpecValidationError('Invalid spec path: must start with "/" and cannot contain ".."');
	}
	if (typeof type !== 'string' || !SPEC_TYPES.includes(type as SpecType)) {
		throw new SpecValidationError(`Invalid spec type: must be one of ${SPEC_TYPES.join(', ')}`);
	}
	return { path, type: type as SpecType };
}

function toSummary(spec: ItemSpec): SpecSummary {
	return { id: spec.id, path: spec.path, type: spec.spec_type, createdAt: spec.created_at };
}

/** List an item's spec links, oldest first. */
export async function listSpecsByItem(projectId: string, itemNumber: number): Promise<SpecSummary[]> {
	const result = await query<ItemSpec>(
		`SELECT s.* FROM epic_specs s
		 JOIN items i ON i.id = s.item_id
		 WHERE s.project_id = $1 AND i.number = $2 AND i.project_id = $1
		 ORDER BY s.created_at ASC`,
		[projectId, itemNumber]
	);
	return result.rows.map(toSummary);
}

/**
 * Add a spec link to an item. Validates input; throws SpecConflictError if the
 * path is already linked. Returns null if the item doesn't exist in the project.
 */
export async function addSpec(
	projectId: string,
	itemNumber: number,
	path: string,
	type: SpecType
): Promise<SpecSummary | null> {
	const item = await query<{ id: string }>(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	const itemId = item.rows[0]?.id;
	if (!itemId) return null;

	try {
		const result = await query<ItemSpec>(
			`INSERT INTO epic_specs (item_id, project_id, path, spec_type)
			 VALUES ($1, $2, $3, $4) RETURNING *`,
			[itemId, projectId, path, type]
		);
		return toSummary(result.rows[0]!);
	} catch (err) {
		if ((err as { code?: string }).code === '23505') {
			throw new SpecConflictError();
		}
		throw err;
	}
}

/**
 * Replace an item's entire set of spec links with the given list (used by MCP
 * create/update where `specs` is a full array). Validates and de-duplicates by
 * path. Returns the new list, or null if the item doesn't exist.
 */
export async function setSpecs(
	projectId: string,
	itemNumber: number,
	specs: Array<{ path: string; type: SpecType }>
): Promise<SpecSummary[] | null> {
	const item = await query<{ id: string }>(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	const itemId = item.rows[0]?.id;
	if (!itemId) return null;

	const byPath = new Map<string, SpecType>();
	for (const s of specs) {
		const { path, type } = validateSpecInput(s.path, s.type);
		byPath.set(path, type);
	}

	return transaction(async (client) => {
		await client.query('DELETE FROM epic_specs WHERE project_id = $1 AND item_id = $2', [projectId, itemId]);
		const out: SpecSummary[] = [];
		for (const [path, type] of byPath) {
			const result = await client.query<ItemSpec>(
				`INSERT INTO epic_specs (item_id, project_id, path, spec_type)
				 VALUES ($1, $2, $3, $4) RETURNING *`,
				[itemId, projectId, path, type]
			);
			out.push(toSummary(result.rows[0]!));
		}
		return out;
	});
}

/** Remove a spec link by id. Returns true if a row was deleted. */
export async function removeSpec(projectId: string, itemNumber: number, specId: string): Promise<boolean> {
	const result = await query(
		`DELETE FROM epic_specs s
		 USING items i
		 WHERE s.id = $1 AND s.item_id = i.id AND i.number = $2 AND s.project_id = $3`,
		[specId, itemNumber, projectId]
	);
	return (result.rowCount ?? 0) > 0;
}

/** Item keys in a project that link the given spec path (reverse lookup for the editor). */
export async function getItemKeysBySpecPath(projectId: string, path: string): Promise<string[]> {
	// Assembled in TypeScript rather than SQL so formatItemKey stays the only place
	// that knows what an item key looks like.
	const result = await query<{ project_key: string; number: number }>(
		`SELECT p.key AS project_key, i.number
		 FROM epic_specs s
		 JOIN items i ON i.id = s.item_id
		 JOIN projects p ON p.id = i.project_id
		 WHERE s.project_id = $1 AND s.path = $2
		 ORDER BY i.number ASC`,
		[projectId, path]
	);
	return result.rows.map((r) => formatItemKey(r.project_key, r.number));
}

/**
 * Repoint spec links from oldPath to newPath when a file is renamed/moved.
 * Drops any source row that would collide with an existing (item_id, newPath)
 * link to respect the unique constraint.
 */
export async function renameSpecPath(projectId: string, oldPath: string, newPath: string): Promise<void> {
	await transaction(async (client) => {
		await client.query(
			`DELETE FROM epic_specs old
			 WHERE old.project_id = $1 AND old.path = $2
			   AND EXISTS (
				 SELECT 1 FROM epic_specs dup
				 WHERE dup.project_id = $1 AND dup.path = $3 AND dup.item_id = old.item_id
			   )`,
			[projectId, oldPath, newPath]
		);
		await client.query(
			'UPDATE epic_specs SET path = $3 WHERE project_id = $1 AND path = $2',
			[projectId, oldPath, newPath]
		);
	});
}

/** Remove all spec links to a path when the file is deleted. */
export async function deleteSpecsByPath(projectId: string, path: string): Promise<void> {
	await query('DELETE FROM epic_specs WHERE project_id = $1 AND path = $2', [projectId, path]);
}
