/**
 * @doc-platform/models - Collection tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Model } from './Model';
import { prop } from './prop';
import { collection } from './collection-decorator';
import { model } from './model-decorator';
import { Collection } from './Collection';

// Test models
class Task extends Model {
	@prop accessor id!: string;
	@prop accessor title!: string;
	@prop accessor status!: 'todo' | 'doing' | 'done';
}

class Epic extends Model {
	@prop accessor id!: string;
	@prop accessor title!: string;
	@collection(Task) accessor tasks!: Collection<Task>;
}

class Settings extends Model {
	@prop accessor theme!: 'light' | 'dark';
	@prop accessor notifications!: boolean;
}

class Project extends Model {
	@prop accessor id!: string;
	@prop accessor name!: string;
	@model(Settings) accessor settings!: Settings;
	@collection(Epic) accessor epics!: Collection<Epic>;
}

describe('Collection', () => {
	describe('initialization', () => {
		it('should initialize with array data', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'Login', status: 'todo' },
					{ id: 't2', title: 'Signup', status: 'doing' },
				],
			});

			expect(epic.tasks.length).toBe(2);
			expect(epic.tasks.at(0)?.title).toBe('Login');
			expect(epic.tasks.at(1)?.status).toBe('doing');
		});

		it('should initialize empty collection when no data provided', () => {
			const epic = new Epic({ id: 'e1', title: 'Auth' });

			expect(epic.tasks.length).toBe(0);
		});

		it('should create Model instances for each item', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
			});

			const task = epic.tasks.at(0);
			expect(task).toBeInstanceOf(Task);
		});
	});

	describe('read access', () => {
		it('should get item at index', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'Login', status: 'todo' },
					{ id: 't2', title: 'Signup', status: 'done' },
				],
			});

			expect(epic.tasks.at(0)?.id).toBe('t1');
			expect(epic.tasks.at(1)?.id).toBe('t2');
			expect(epic.tasks.at(2)).toBeUndefined();
		});

		it('should support iteration', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'Login', status: 'todo' },
					{ id: 't2', title: 'Signup', status: 'done' },
				],
			});

			const ids: string[] = [];
			for (const task of epic.tasks) {
				ids.push(task.id);
			}

			expect(ids).toEqual(['t1', 't2']);
		});

		it('should support map', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'Login', status: 'todo' },
					{ id: 't2', title: 'Signup', status: 'done' },
				],
			});

			const titles = epic.tasks.map((t) => t.title);

			expect(titles).toEqual(['Login', 'Signup']);
		});

		it('should support filter', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'Login', status: 'todo' },
					{ id: 't2', title: 'Signup', status: 'done' },
				],
			});

			const doneTasks = epic.tasks.filter((t) => t.status === 'done');

			expect(doneTasks.length).toBe(1);
			expect(doneTasks[0].id).toBe('t2');
		});

		it('should support find', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'Login', status: 'todo' },
					{ id: 't2', title: 'Signup', status: 'done' },
				],
			});

			const task = epic.tasks.find((t) => t.id === 't2');

			expect(task?.title).toBe('Signup');
		});

		it('should support toArray', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
			});

			const arr = epic.tasks.toArray();

			expect(Array.isArray(arr)).toBe(true);
			expect(arr.length).toBe(1);
		});
	});

	describe('mutations', () => {
		it('should add items', () => {
			const epic = new Epic({ id: 'e1', title: 'Auth', tasks: [] });

			const task = epic.tasks.add({ id: 't1', title: 'Login', status: 'todo' });

			expect(epic.tasks.length).toBe(1);
			expect(task).toBeInstanceOf(Task);
			expect(epic.tasks.at(0)).toBe(task);
		});

		it('should insert items at index', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'First', status: 'todo' },
					{ id: 't3', title: 'Third', status: 'todo' },
				],
			});

			epic.tasks.insert(1, { id: 't2', title: 'Second', status: 'todo' });

			expect(epic.tasks.length).toBe(3);
			expect(epic.tasks.at(1)?.title).toBe('Second');
		});

		it('should remove items', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
			});

			const task = epic.tasks.at(0)!;
			const removed = epic.tasks.remove(task);

			expect(removed).toBe(true);
			expect(epic.tasks.length).toBe(0);
		});

		it('should remove items at index', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'First', status: 'todo' },
					{ id: 't2', title: 'Second', status: 'todo' },
				],
			});

			const removed = epic.tasks.removeAt(0);

			expect(removed?.id).toBe('t1');
			expect(epic.tasks.length).toBe(1);
			expect(epic.tasks.at(0)?.id).toBe('t2');
		});

		it('should move items', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'First', status: 'todo' },
					{ id: 't2', title: 'Second', status: 'todo' },
					{ id: 't3', title: 'Third', status: 'todo' },
				],
			});

			epic.tasks.move(0, 2);

			expect(epic.tasks.at(0)?.id).toBe('t2');
			expect(epic.tasks.at(1)?.id).toBe('t3');
			expect(epic.tasks.at(2)?.id).toBe('t1');
		});

		it('should clear all items', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [
					{ id: 't1', title: 'First', status: 'todo' },
					{ id: 't2', title: 'Second', status: 'todo' },
				],
			});

			epic.tasks.clear();

			expect(epic.tasks.length).toBe(0);
		});

		it('should reset with new data', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Old', status: 'todo' }],
			});

			epic.tasks.reset([
				{ id: 't2', title: 'New1', status: 'doing' },
				{ id: 't3', title: 'New2', status: 'done' },
			]);

			expect(epic.tasks.length).toBe(2);
			expect(epic.tasks.at(0)?.title).toBe('New1');
		});
	});

	describe('event bubbling', () => {
		it('should emit change on parent when child changes', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
			});
			const callback = vi.fn();

			epic.on('change', callback);
			epic.tasks.at(0)!.status = 'doing';

			expect(callback).toHaveBeenCalledTimes(1);
		});

		it('should emit change on parent when collection adds item', () => {
			const epic = new Epic({ id: 'e1', title: 'Auth', tasks: [] });
			const callback = vi.fn();

			epic.on('change', callback);
			epic.tasks.add({ id: 't1', title: 'New', status: 'todo' });

			expect(callback).toHaveBeenCalledTimes(1);
		});

		it('should emit change on parent when collection removes item', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
			});
			const callback = vi.fn();

			epic.on('change', callback);
			epic.tasks.removeAt(0);

			expect(callback).toHaveBeenCalledTimes(1);
		});

		it('should allow subscribing directly to collection', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
			});
			const collectionCallback = vi.fn();
			const epicCallback = vi.fn();

			epic.tasks.on('change', collectionCallback);
			epic.on('change', epicCallback);

			epic.tasks.at(0)!.title = 'Updated';

			expect(collectionCallback).toHaveBeenCalledTimes(1);
			expect(epicCallback).toHaveBeenCalledTimes(1);
		});

		it('should unsubscribe from removed items', () => {
			const epic = new Epic({
				id: 'e1',
				title: 'Auth',
				tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
			});
			const callback = vi.fn();

			const task = epic.tasks.at(0)!;
			epic.on('change', callback);

			epic.tasks.remove(task);
			callback.mockClear();

			// Changing removed task should NOT trigger parent
			task.status = 'done';

			expect(callback).not.toHaveBeenCalled();
		});
	});

	describe('deep nesting', () => {
		it('should bubble changes through multiple levels', () => {
			const project = new Project({
				id: 'p1',
				name: 'Doc Platform',
				settings: { theme: 'dark', notifications: true },
				epics: [
					{
						id: 'e1',
						title: 'Auth',
						tasks: [{ id: 't1', title: 'Login', status: 'todo' }],
					},
				],
			});
			const callback = vi.fn();

			project.on('change', callback);

			// Change deep nested task
			project.epics.at(0)!.tasks.at(0)!.status = 'doing';

			expect(callback).toHaveBeenCalledTimes(1);
		});
	});
});

describe('@model decorator', () => {
	it('should initialize nested model from data', () => {
		const project = new Project({
			id: 'p1',
			name: 'Test',
			settings: { theme: 'dark', notifications: false },
			epics: [],
		});

		expect(project.settings).toBeInstanceOf(Settings);
		expect(project.settings.theme).toBe('dark');
		expect(project.settings.notifications).toBe(false);
	});

	it('should bubble changes from nested model', () => {
		const project = new Project({
			id: 'p1',
			name: 'Test',
			settings: { theme: 'dark', notifications: true },
			epics: [],
		});
		const callback = vi.fn();

		project.on('change', callback);
		project.settings.theme = 'light';

		expect(callback).toHaveBeenCalledTimes(1);
	});

	it('should replace nested model via setter', () => {
		const project = new Project({
			id: 'p1',
			name: 'Test',
			settings: { theme: 'dark', notifications: true },
			epics: [],
		});
		const callback = vi.fn();

		project.on('change', callback);
		project.settings = new Settings({ theme: 'light', notifications: false });

		expect(callback).toHaveBeenCalledTimes(1);
		expect(project.settings.theme).toBe('light');
	});

	it('should handle setting nested model with raw data', () => {
		const project = new Project({
			id: 'p1',
			name: 'Test',
			settings: { theme: 'dark', notifications: true },
			epics: [],
		});

		// @ts-expect-error - Testing raw data assignment
		project.settings = { theme: 'light', notifications: false };

		expect(project.settings).toBeInstanceOf(Settings);
		expect(project.settings.theme).toBe('light');
	});
});
