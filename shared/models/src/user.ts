/**
 * User model
 *
 * Extends SyncModel with CRUD pattern: /api/users/:id
 * Pass id='me' to fetch the current authenticated user.
 *
 * @example
 * ```tsx
 * // Current user (id='me' resolves to real ID after fetch)
 * const user = useMemo(() => new UserModel({ id: 'me' }), []);
 * useModel(user);
 *
 * // Specific user by ID
 * const user = useMemo(() => new UserModel({ id: userId }), [userId]);
 * useModel(user);
 * ```
 */

import { SyncModel } from './SyncModel';
import { prop } from './prop';

export class UserModel extends SyncModel {
	static override url = '/api/users/:id';

	@prop accessor id!: string;
	@prop accessor email!: string;
	@prop accessor username!: string;
	@prop accessor first_name!: string;
	@prop accessor last_name!: string;
	@prop accessor email_verified!: boolean;
	@prop accessor phone_number!: string | null;
	@prop accessor avatar_url!: string | null;
	@prop accessor roles!: string[];
	@prop accessor is_active!: boolean;
	@prop accessor created_at!: string;
	@prop accessor updated_at!: string;
	@prop accessor deactivated_at!: string | null;
}
