import { describe, expect, it } from 'vitest';
import { mapSetup, scopeKey, type MapProject } from './map-projects';

const PROJECTS: MapProject[] = [
	{ ref: 'acme/specboard', key: 'SPE', name: 'Specboard' },
	{ ref: 'kim/planner', key: 'PLN', name: 'Planner' },
];

describe('mapSetup', () => {
	it('reads one project for a project\'s own Map, which every item is in', () => {
		const setup = mapSetup({ projectRef: 'acme/specboard' });
		expect(setup.refs).toEqual(['acme/specboard']);
		expect(setup.own).toBe('acme/specboard');
		expect(setup.refOf('SPE-4')).toBe('acme/specboard');
	});

	it('reads every chosen project for the combined view, in the order given, and finds an item\'s project by its prefix', () => {
		const setup = mapSetup({ projects: PROJECTS });
		expect(setup.refs).toEqual(['acme/specboard', 'kim/planner']);
		expect(setup.own).toBeNull();
		expect(setup.refOf('SPE-4')).toBe('acme/specboard');
		expect(setup.refOf('PLN-31')).toBe('kim/planner');
		expect(() => setup.refOf('XYZ-1')).toThrow('XYZ-1 is from none of the projects on the Map');
		expect(() => setup.refOf('not a key')).toThrow('not a key is from none of the projects on the Map');
	});

	it('refuses two projects under one prefix, since every item key has to name one project', () => {
		expect(() => mapSetup({ projects: [PROJECTS[0]!, { ref: 'lee/spec', key: 'SPE', name: 'Spec' }] })).toThrow('Two projects on one Map can\'t share the prefix SPE');
	});
});

describe('scopeKey', () => {
	it('is the same for the same projects in a new object, and changes with the projects or their prefixes', () => {
		expect(scopeKey({ projects: PROJECTS.map((project) => ({ ...project })) })).toBe(scopeKey({ projects: PROJECTS }));
		expect(scopeKey({ projects: [PROJECTS[0]!] })).not.toBe(scopeKey({ projects: PROJECTS }));
		expect(scopeKey({ projects: [PROJECTS[0]!, { ...PROJECTS[1]!, key: 'PL' }] })).not.toBe(scopeKey({ projects: PROJECTS }));
		expect(scopeKey({ projectRef: 'acme/specboard' })).toBe(scopeKey({ projectRef: 'acme/specboard' }));
	});

	it('does not change when only a name does, which no read depends on', () => {
		expect(scopeKey({ projects: [{ ...PROJECTS[0]!, name: 'Renamed' }, PROJECTS[1]!] })).toBe(scopeKey({ projects: PROJECTS }));
	});
});
