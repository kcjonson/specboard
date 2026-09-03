/**
 * Guards the boundary this codebase now depends on: a project is addressed in URLs by
 * its **slug**, and by its **id** only as a local-storage key. The two are different
 * strings of the same type, so nothing in the type system keeps them apart — a UUID
 * interpolated into `/api/projects/${...}` typechecks perfectly and 404s at runtime,
 * which is exactly how it shipped once (Editor's document save).
 *
 * This scans the frontend source rather than exercising a component, because the bug
 * lives in string interpolation that no component test would naturally cover.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const SCAN_DIRS = ['shared/models', 'shared/pages', 'shared/planning', 'shared/projects', 'shared/ui', 'web/src'];

/** Interpolations in a project-scoped API path: `/api/projects/${expr}` */
const API_PROJECT_PATH = /\/api\/projects\/\$\{([^}]+)\}/g;

/** Names that legitimately hold a slug. Anything else is presumed to be an id. */
const SLUG_NAMED = /slug/i;

function sourceFiles(dir: string): string[] {
	const abs = join(ROOT, dir);
	const out: string[] = [];
	const walk = (d: string): void => {
		for (const entry of readdirSync(d)) {
			if (entry === 'node_modules' || entry.startsWith('.')) continue;
			const full = join(d, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
		}
	};
	walk(abs);
	return out;
}

describe('project URL boundary', () => {
	it('addresses /api/projects/... by slug, never by id', () => {
		const offenders: string[] = [];

		for (const dir of SCAN_DIRS) {
			for (const file of sourceFiles(dir)) {
				const source = readFileSync(file, 'utf-8');
				for (const match of source.matchAll(API_PROJECT_PATH)) {
					const expr = match[1]!.trim();
					if (SLUG_NAMED.test(expr)) continue;
					const line = source.slice(0, match.index).split('\n').length;
					offenders.push(`${relative(ROOT, file)}:${line} -> \${${expr}}`);
				}
			}
		}

		expect(offenders, `Project API paths must interpolate a slug. Found:\n${offenders.join('\n')}`)
			.toEqual([]);
	});

	it('actually detects a violation (the guard is not vacuous)', () => {
		const sample = 'fetchClient.put(`/api/projects/${projectId}/files`)';
		const found = [...sample.matchAll(API_PROJECT_PATH)].map((m) => m[1]!.trim());
		expect(found).toEqual(['projectId']);
		expect(found.some((e) => SLUG_NAMED.test(e))).toBe(false);
	});
});
