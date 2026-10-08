/**
 * The multi-project view's address and selection: what `?projects=` may hold, the
 * address the picker builds, how a selection meets the projects a person can read,
 * and the remembered set the picker starts from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../test-support/memory-storage';
import {
	MAX_PROJECTS,
	leftOutNotices,
	multiProjectUrl,
	parseSelection,
	readRememberedSelection,
	rememberSelection,
	resolveSelection,
	mapTroubleNotices,
	type ListedProject,
} from './selection';

function refsOf(count: number): string {
	return Array.from({ length: count }, (_, i) => `acme/p${i + 1}`).join(',');
}

function listed(ownerSlug: string, slug: string, key: string, name: string): ListedProject {
	return { ownerSlug, slug, key, name };
}

describe('parseSelection', () => {
	it('reads comma-separated owner/project refs, in the order given', () => {
		expect(parseSelection('bob/notes,acme/roadmap')).toEqual({ ok: true, refs: ['bob/notes', 'acme/roadmap'] });
	});

	it('normalizes a hand-typed ref and skips empty entries', () => {
		expect(parseSelection(' Acme/Roadmap , bob/notes,')).toEqual({ ok: true, refs: ['acme/roadmap', 'bob/notes'] });
	});

	it('reads the encoded form a browser may have rewritten the address to', () => {
		const param = new URLSearchParams('projects=acme%2Froadmap%2Cbob%2Fnotes').get('projects');
		expect(parseSelection(param)).toEqual({ ok: true, refs: ['acme/roadmap', 'bob/notes'] });
	});

	it('takes between two and ten projects', () => {
		expect(parseSelection(refsOf(2)).ok).toBe(true);
		expect(parseSelection(refsOf(MAX_PROJECTS)).ok).toBe(true);
		expect(parseSelection(null)).toEqual({ ok: false, problem: "This link doesn't name any projects." });
		expect(parseSelection('acme/roadmap')).toEqual({
			ok: false,
			problem: 'This link names one project, and viewing together takes at least 2.',
		});
		expect(parseSelection(refsOf(11))).toEqual({
			ok: false,
			problem: 'This link names 11 projects, and at most 10 can be viewed together.',
		});
	});

	it('refuses an entry that is not an owner/project address', () => {
		for (const entry of ['roadmap', 'acme/roadmap/extra', 'acme/Road Map', 'acme/-roadmap']) {
			const selection = parseSelection(`bob/notes,${entry}`);
			expect(selection.ok).toBe(false);
			if (!selection.ok) expect(selection.problem).toContain(`"${entry}" isn't a project address`);
		}
	});

	it('quotes no more than 60 characters of an entry back', () => {
		const entry = `acme/${'x'.repeat(200)}`;
		const selection = parseSelection(`bob/notes,${entry}`);
		expect(selection).toEqual({
			ok: false,
			problem: `"${entry.slice(0, 60)}..." isn't a project address. Addresses look like owner/project.`,
		});
	});

	it('refuses a project listed twice, however it was written', () => {
		expect(parseSelection('acme/roadmap,bob/notes,ACME/roadmap')).toEqual({ ok: false, problem: 'acme/roadmap is in the list twice.' });
	});
});

describe('multiProjectUrl', () => {
	it('writes the refs unencoded, and they read back as written', () => {
		const url = multiProjectUrl(['acme/roadmap', 'bob/notes']);
		expect(url).toBe('/planning?projects=acme/roadmap,bob/notes');
		expect(parseSelection(new URL(url, 'http://x').searchParams.get('projects'))).toEqual({
			ok: true,
			refs: ['acme/roadmap', 'bob/notes'],
		});
	});
});

describe('resolveSelection', () => {
	const projects = [
		listed('acme', 'roadmap', 'RM', 'Roadmap'),
		listed('bob', 'notes', 'NOT', 'Notes'),
		listed('bob', 'specboard', 'SPE', "Bob's Specboard"),
		listed('acme', 'specboard', 'SPE', 'Specboard'),
	];

	it('keeps the order asked for, labelled by name and key prefix', () => {
		expect(resolveSelection(['bob/notes', 'acme/roadmap'], projects)).toEqual({
			projects: [
				{ ref: 'bob/notes', name: 'Notes', key: 'NOT' },
				{ ref: 'acme/roadmap', name: 'Roadmap', key: 'RM' },
			],
			missing: [],
			clashes: [],
		});
	});

	it('sets aside refs that are not among the readable projects', () => {
		const resolved = resolveSelection(['acme/roadmap', 'carol/secret', 'bob/notes'], projects);
		expect(resolved.projects.map((project) => project.ref)).toEqual(['acme/roadmap', 'bob/notes']);
		expect(resolved.missing).toEqual(['carol/secret']);
	});

	it('drops the later of two projects that share a key prefix, saying which one has it', () => {
		const resolved = resolveSelection(['acme/specboard', 'acme/roadmap', 'bob/specboard'], projects);
		expect(resolved.projects.map((project) => project.ref)).toEqual(['acme/specboard', 'acme/roadmap']);
		expect(resolved.clashes).toEqual([
			{
				project: { ref: 'bob/specboard', name: "Bob's Specboard", key: 'SPE' },
				holder: { ref: 'acme/specboard', name: 'Specboard', key: 'SPE' },
			},
		]);
	});
});

describe('leftOutNotices', () => {
	const clash = {
		project: { ref: 'bob/specboard', name: "Bob's Specboard", key: 'SPE' },
		holder: { ref: 'acme/specboard', name: 'Specboard', key: 'SPE' },
	};

	it('says nothing when everything is shown', () => {
		expect(leftOutNotices([], [])).toEqual([]);
	});

	it('names what it cannot read in one line, and each key clash in its own', () => {
		expect(leftOutNotices(['carol/secret'], [])).toEqual(["carol/secret isn't shown: it doesn't exist, or you can't read it."]);
		expect(leftOutNotices(['carol/secret', 'Notes', 'dave/old'], [clash])).toEqual([
			"carol/secret, Notes, and dave/old aren't shown: they don't exist, or you can't read them.",
			"Bob's Specboard (bob/specboard) isn't shown: its key SPE is already used by Specboard.",
		]);
		expect(leftOutNotices(['carol/secret', 'Notes'], [])).toEqual([
			"carol/secret and Notes aren't shown: they don't exist, or you can't read them.",
		]);
	});
});

describe('mapTroubleNotices', () => {
	it('says nothing while every read on the Map lands', () => {
		expect(mapTroubleNotices([], [])).toEqual([]);
	});

	it('names the projects drawn as last loaded in one line, and those not drawn at all in another', () => {
		expect(mapTroubleNotices(['Atlas'], [])).toEqual([
			"Atlas couldn't be refreshed, so the Map shows it as last loaded. The Map keeps trying.",
		]);
		expect(mapTroubleNotices(['Atlas', 'Beacon'], ['Comet'])).toEqual([
			"Atlas and Beacon couldn't be refreshed, so the Map shows them as last loaded. The Map keeps trying.",
			"Comet couldn't be loaded on the Map, so it isn't drawn. The Map keeps trying.",
		]);
		expect(mapTroubleNotices([], ['Atlas', 'Beacon', 'Comet'])).toEqual([
			"Atlas, Beacon, and Comet couldn't be loaded on the Map, so they aren't drawn. The Map keeps trying.",
		]);
	});
});

describe('the remembered selection', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', memoryStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads back the refs last remembered, in order', () => {
		expect(readRememberedSelection()).toEqual([]);
		rememberSelection(['bob/notes', 'acme/roadmap']);
		expect(readRememberedSelection()).toEqual(['bob/notes', 'acme/roadmap']);
	});

	it('is empty, and quietly not kept, while storage is blocked', () => {
		const blocked = memoryStorage();
		blocked.getItem = () => {
			throw new Error('SecurityError');
		};
		blocked.setItem = () => {
			throw new Error('SecurityError');
		};
		vi.stubGlobal('localStorage', blocked);

		expect(() => rememberSelection(['bob/notes', 'acme/roadmap'])).not.toThrow();
		expect(readRememberedSelection()).toEqual([]);
	});
});
