/**
 * User model for current authenticated user
 *
 * Used by Settings page to display and update user profile.
 * Syncs with /api/auth/me - a singleton endpoint for the current user.
 */

import { fetchClient } from '@doc-platform/fetch';
import { Model } from './Model';
import { prop } from './prop';
import type { ModelMeta, ModelData } from './types';

/**
 * UserModel - represents the current authenticated user
 *
 * Unlike other SyncModels, this is a singleton that syncs with /api/auth/me.
 * Auto-fetches on construction (no id needed).
 *
 * @example
 * ```tsx
 * const user = useMemo(() => new UserModel(), []);
 * useModel(user);
 *
 * if (user.$meta.working) return <Loading />;
 * if (user.$meta.error) return <Error />;
 *
 * return <div>{user.displayName}</div>;
 * ```
 */
export class UserModel extends Model {
	static url = '/api/auth/me';

	declare readonly $meta: ModelMeta;

	@prop accessor id!: string;
	@prop accessor email!: string;
	@prop accessor username!: string;
	@prop accessor displayName!: string;
	@prop accessor first_name!: string;
	@prop accessor last_name!: string;
	@prop accessor email_verified!: boolean;
	@prop accessor phone_number!: string | null;
	@prop accessor avatar_url!: string | null;

	constructor() {
		super();

		// Override $meta with sync-specific fields
		Object.defineProperty(this, '$meta', {
			value: {
				working: false,
				error: null,
				lastFetched: null,
			},
			enumerable: false,
			writable: false,
		});

		// Auto-fetch on construction
		this.fetch();
	}

	/**
	 * Updates $meta state.
	 */
	private setMeta(updates: Partial<ModelMeta>): void {
		Object.assign(this.$meta, updates);
	}

	/**
	 * Fetches user data from the API.
	 */
	async fetch(): Promise<void> {
		this.setMeta({ working: true, error: null });

		try {
			const response = await fetchClient.get<{ user: Record<string, unknown> }>(
				(this.constructor as typeof UserModel).url
			);
			this.set(response.user as Partial<ModelData<this>>);
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
	 * Saves user profile changes to the API.
	 */
	async save(): Promise<void> {
		this.setMeta({ working: true, error: null });

		try {
			// Access internal data
			const internalData = (this as unknown as { __data: Record<string, unknown> }).__data;

			// Only send editable fields
			const updateData = {
				first_name: internalData.first_name,
				last_name: internalData.last_name,
			};

			const response = await fetchClient.put<{ user: Record<string, unknown> }>(
				(this.constructor as typeof UserModel).url,
				updateData
			);
			this.set(response.user as Partial<ModelData<this>>);
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
