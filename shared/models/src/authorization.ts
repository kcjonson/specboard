/**
 * Authorization models for OAuth authorized apps
 *
 * Used by Settings > Authorized Apps UI to display and manage
 * OAuth authorizations (MCP tokens).
 */

import { SyncModel } from './SyncModel';
import { SyncCollection } from './SyncCollection';
import { prop } from './prop';

/**
 * Authorization model - represents a single OAuth authorization (MCP token)
 *
 * Syncs with /api/oauth/authorizations/:id for DELETE operations.
 * Does not support create/update - authorizations are created via OAuth flow.
 */
export class AuthorizationModel extends SyncModel {
	static override url = '/api/oauth/authorizations/:id';

	@prop accessor id!: string;
	@prop accessor client_id!: string;
	@prop accessor device_name!: string;
	@prop accessor scopes!: string[];
	@prop accessor created_at!: string;
	@prop accessor last_used_at!: string | null;
}

/**
 * Collection of authorizations - syncs with /api/oauth/authorizations
 *
 * @example
 * ```tsx
 * const authorizations = new AuthorizationsCollection();
 * useModel(authorizations);
 *
 * if (authorizations.$meta.working) return <Loading />;
 * if (authorizations.$meta.error) return <Error />;
 *
 * return authorizations.map(auth => <AuthItem auth={auth} />);
 * ```
 */
export class AuthorizationsCollection extends SyncCollection<AuthorizationModel> {
	static url = '/api/oauth/authorizations';
	static Model = AuthorizationModel;
}
