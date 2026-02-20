/**
 * @specboard/models - SyncModel class
 *
 * Extends Model with REST API synchronization.
 * Auto-fetches on construction, provides save/delete methods.
 *
 * @example
 * ```typescript
 * class Post extends SyncModel {
 *   static url = '/api/posts/:id';
 *
 *   @prop accessor id!: number;
 *   @prop accessor title!: string;
 *   @prop accessor body!: string;
 * }
 *
 * const post = new Post({ id: 123 }); // Auto-fetches from /api/posts/123
 * ```
 */

import { fetchClient } from '@specboard/fetch';
import { Model } from './Model';
import type { ModelMeta, ModelData } from './types';

interface SyncModelConstructor {
	url?: string;
	idField?: string;
}

export class SyncModel extends Model {
	/** URL template for API endpoint (e.g., '/api/users/:id') */
	static url: string = '';

	/** Field used as the ID (default: 'id') */
	static idField: string = 'id';

	declare readonly $meta: ModelMeta;

	constructor(initialData?: Record<string, unknown>) {
		super(initialData);

		// Override $meta with SyncModel-specific fields
		Object.defineProperty(this, '$meta', {
			value: {
				working: false,
				error: null,
				lastFetched: null,
			},
			enumerable: false,
			writable: false,
		});

		// Auto-fetch if we have an ID but no other data (loading existing record)
		// Skip auto-fetch if already hydrated with data (e.g., created by collection)
		const ctor = this.constructor as unknown as SyncModelConstructor;
		const idField = ctor.idField || 'id';
		const internalData = (this as unknown as { __data: Record<string, unknown> }).__data;
		const id = internalData[idField];
		const dataKeys = Object.keys(internalData).filter(k => k !== idField && k !== 'projectId');
		const needsFetch = id && dataKeys.length === 0;
		if (needsFetch) {
			this.fetch();
		}
	}

	/**
	 * Builds the URL for this model instance by substituting params from instance properties.
	 */
	private buildUrl(): string {
		const ctor = this.constructor as unknown as SyncModelConstructor;
		const template = ctor.url || '';

		if (!template) {
			throw new Error(`SyncModel "${this.constructor.name}" has no URL. Set static url property.`);
		}

		return template.replace(/:(\w+)/g, (_, key) => {
			const value = (this as Record<string, unknown>)[key];
			if (value === undefined) {
				throw new Error(`Missing URL param "${key}" on ${this.constructor.name}`);
			}
			return String(value);
		});
	}

	/**
	 * Updates $meta state.
	 */
	private setMeta(updates: Partial<ModelMeta>): void {
		Object.assign(this.$meta, updates);
	}

	/**
	 * Fetches data from the API.
	 */
	async fetch(): Promise<void> {
		this.setMeta({ working: true, error: null });

		try {
			const data = await fetchClient.get<Record<string, unknown>>(this.buildUrl());
			this.set(data as Partial<ModelData<this>>);
			this.setMeta({ working: false, lastFetched: Date.now() });
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}

	/**
	 * Saves data to the API.
	 * Uses POST for new records (no ID), PUT for existing records.
	 */
	async save(): Promise<void> {
		this.setMeta({ working: true, error: null });

		const ctor = this.constructor as unknown as SyncModelConstructor;
		const idField = ctor.idField || 'id';
		// Access internal data through protected property
		const internalData = (this as unknown as { __data: Record<string, unknown> }).__data;
		const id = internalData[idField];

		try {
			const data = { ...internalData };

			if (id) {
				// Update existing
				const result = await fetchClient.put<Record<string, unknown>>(this.buildUrl(), data);
				this.set(result as Partial<ModelData<this>>);
			} else {
				// Create new - build URL but skip the :id param
				const template = ctor.url || '';
				const baseUrl = template.replace(/:(\w+)/g, (_, key) => {
					// Skip the id field param for POST (it doesn't exist yet)
					if (key === idField) return '';
					const value = (this as Record<string, unknown>)[key];
					if (value === undefined) {
						throw new Error(`Missing URL param "${key}" on ${this.constructor.name}`);
					}
					return String(value);
				}).replace(/\/+$/, ''); // Clean trailing slashes
				const result = await fetchClient.post<Record<string, unknown>>(baseUrl, data);
				this.set(result as Partial<ModelData<this>>);
			}

			this.setMeta({ working: false });
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}

	/**
	 * Deletes this record from the API.
	 */
	async delete(): Promise<void> {
		this.setMeta({ working: true, error: null });

		try {
			await fetchClient.delete(this.buildUrl());
			this.setMeta({ working: false });
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}
}
