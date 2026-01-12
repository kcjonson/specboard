/**
 * Unified user management handlers
 *
 * Access control:
 * - GET /api/users: Admin only (list all users)
 * - GET /api/users/:id: Admin can view any user, users can view themselves
 * - PUT /api/users/:id: Admin can edit any user (all fields), users can edit themselves (limited fields)
 * - POST /api/users: Admin only (create new user)
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME, hashPassword, validatePassword } from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';
import { isValidUUID, isValidEmail, isValidUsername } from '../validation.ts';

/**
 * Get current user from session, including their roles
 * Returns null if user is not found or is inactive
 */
async function getCurrentUser(context: Context, redis: Redis): Promise<User | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;

	const session = await getSession(redis, sessionId);
	if (!session) return null;

	const result = await query<User>(
		'SELECT * FROM users WHERE id = $1',
		[session.userId]
	);

	const user = result.rows[0];

	// Return null if user doesn't exist or is inactive
	// This prevents deactivated users from accessing any user management APIs
	if (!user || !user.is_active) {
		return null;
	}

	return user;
}

/**
 * Check if user has admin role
 */
function isAdmin(user: User): boolean {
	return user.roles.includes('admin');
}

/**
 * User response type for API
 */
interface UserApiResponse {
	id: string;
	username: string;
	email: string;
	first_name: string;
	last_name: string;
	email_verified: boolean;
	roles: string[];
	is_active: boolean;
	created_at: string;
	updated_at: string;
	deactivated_at: string | null;
}

function userToApiResponse(user: User): UserApiResponse {
	return {
		id: user.id,
		username: user.username,
		email: user.email,
		first_name: user.first_name,
		last_name: user.last_name,
		email_verified: user.email_verified,
		roles: user.roles,
		is_active: user.is_active,
		created_at: user.created_at.toISOString(),
		updated_at: user.updated_at.toISOString(),
		deactivated_at: user.deactivated_at?.toISOString() ?? null,
	};
}

// Valid roles that can be assigned
const VALID_ROLES = new Set(['admin']);

// Superadmin username - this account is immutable
const SUPERADMIN_USERNAME = 'superadmin';

function isValidRole(role: string): boolean {
	return VALID_ROLES.has(role);
}

// Fields that regular users can update on themselves (all others require admin)
const USER_EDITABLE_FIELDS = new Set(['first_name', 'last_name']);

/**
 * Filter an update object to only include fields the user can modify
 */
function filterUpdates(
	updates: UpdateUserRequest,
	canEditAll: boolean
): UpdateUserRequest {
	if (canEditAll) return updates;

	const filtered: UpdateUserRequest = {};
	if (updates.first_name !== undefined) filtered.first_name = updates.first_name;
	if (updates.last_name !== undefined) filtered.last_name = updates.last_name;
	return filtered;
}

/**
 * Check if request includes fields that require admin access
 */
function hasAdminOnlyFields(updates: UpdateUserRequest): boolean {
	return Object.keys(updates).some(
		key => updates[key as keyof UpdateUserRequest] !== undefined && !USER_EDITABLE_FIELDS.has(key)
	);
}

/**
 * List all users (admin only)
 * GET /api/users
 */
export async function handleListUsers(
	context: Context,
	redis: Redis
): Promise<Response> {
	const currentUser = await getCurrentUser(context, redis);
	if (!currentUser) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	if (!isAdmin(currentUser)) {
		return context.json({ error: 'Admin access required' }, 403);
	}

	const { search, role, is_active, limit, offset } = context.req.query();

	// Parse pagination
	const limitNum = Math.min(Math.max(parseInt(limit || '50', 10), 1), 100);
	const offsetNum = Math.max(parseInt(offset || '0', 10), 0);

	// Build query with filters
	const conditions: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (search) {
		conditions.push(`(
			LOWER(username) LIKE LOWER($${paramIndex}) OR
			LOWER(email) LIKE LOWER($${paramIndex}) OR
			LOWER(first_name) LIKE LOWER($${paramIndex}) OR
			LOWER(last_name) LIKE LOWER($${paramIndex})
		)`);
		params.push(`%${search}%`);
		paramIndex++;
	}

	if (role && isValidRole(role)) {
		conditions.push(`$${paramIndex} = ANY(roles)`);
		params.push(role);
		paramIndex++;
	}

	if (is_active !== undefined && is_active !== '') {
		conditions.push(`is_active = $${paramIndex}`);
		params.push(is_active === 'true');
		paramIndex++;
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	try {
		const countResult = await query<{ count: string }>(
			`SELECT COUNT(*) as count FROM users ${whereClause}`,
			params
		);
		const total = parseInt(countResult.rows[0]?.count || '0', 10);

		const usersResult = await query<User>(
			`SELECT * FROM users ${whereClause}
			 ORDER BY created_at DESC
			 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
			[...params, limitNum, offsetNum]
		);

		return context.json({
			users: usersResult.rows.map(userToApiResponse),
			total,
			limit: limitNum,
			offset: offsetNum,
		});
	} catch (error) {
		console.error('Failed to list users:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/**
 * Get a user by ID
 * GET /api/users/:id
 *
 * Special case: "me" as ID returns the current user with CSRF token
 * Admin: Can view any user
 * User: Can only view themselves
 */
export async function handleGetUser(
	context: Context,
	redis: Redis
): Promise<Response> {
	const currentUser = await getCurrentUser(context, redis);
	if (!currentUser) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const idParam = context.req.param('id');

	// Handle "me" as a special case - return current user
	if (idParam === 'me') {
		return context.json(userToApiResponse(currentUser));
	}

	if (!isValidUUID(idParam)) {
		return context.json({ error: 'Invalid user ID format' }, 400);
	}

	// Non-admins can only view themselves
	if (!isAdmin(currentUser) && currentUser.id !== idParam) {
		return context.json({ error: 'Access denied' }, 403);
	}

	try {
		const result = await query<User>(
			'SELECT * FROM users WHERE id = $1',
			[idParam]
		);

		const user = result.rows[0];
		if (!user) {
			return context.json({ error: 'User not found' }, 404);
		}

		return context.json(userToApiResponse(user));
	} catch (error) {
		console.error('Failed to get user:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

interface UpdateUserRequest {
	username?: string;
	email?: string;
	first_name?: string;
	last_name?: string;
	roles?: string[];
	is_active?: boolean;
	email_verified?: boolean;
	password?: string;
}

/**
 * Update a user
 * PUT /api/users/:id
 *
 * Special case: "me" as ID updates the current user
 * Admin: Can update any user, all fields (username, email, first_name, last_name, roles, is_active)
 * User: Can only update themselves, limited fields (first_name, last_name)
 */
export async function handleUpdateUser(
	context: Context,
	redis: Redis
): Promise<Response> {
	const currentUser = await getCurrentUser(context, redis);
	if (!currentUser) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const idParam = context.req.param('id');

	// Resolve "me" to the current user's ID
	const id = idParam === 'me' ? currentUser.id : idParam;

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid user ID format' }, 400);
	}

	const isSelf = currentUser.id === id;
	const userIsAdmin = isAdmin(currentUser);

	// Non-admins can only update themselves
	if (!userIsAdmin && !isSelf) {
		return context.json({ error: 'Access denied' }, 403);
	}

	// Check if target is superadmin
	const targetCheck = await query<{ username: string }>(
		'SELECT username FROM users WHERE id = $1',
		[id]
	);
	const targetIsSuperadmin = targetCheck.rows[0]?.username === SUPERADMIN_USERNAME;

	let body: UpdateUserRequest;
	try {
		body = await context.req.json<UpdateUserRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const currentUserIsSuperadmin = currentUser.username === SUPERADMIN_USERNAME && isAdmin(currentUser);
	const passwordProvided = body.password !== undefined;

	// Password can only be set by superadmin (must have admin role AND superadmin username), and not on self
	const canSetPassword = currentUserIsSuperadmin && !isSelf && passwordProvided;

	// If password was provided but user can't set it, log and silently remove before field checks
	if (passwordProvided && !canSetPassword) {
		console.warn(
			`users.update: Ignoring password field for user ${currentUser.id} (${currentUser.username}) updating target ${id} (isSelf=${isSelf}, isAdmin=${userIsAdmin}, isSuperadmin=${currentUserIsSuperadmin})`
		);
		delete (body as Record<string, unknown>).password;
	}

	if (canSetPassword) {
		// Validate password strength
		const passwordValidation = validatePassword(body.password!);
		if (!passwordValidation.valid) {
			return context.json(
				{ error: 'Password does not meet the required complexity. Must be 12+ characters with uppercase, lowercase, digit, and special character.' },
				400
			);
		}
	}

	// Filter to only fields user can update
	const permitted = filterUpdates(body, userIsAdmin);

	// Reject if non-admin tried to update admin-only fields
	if (!userIsAdmin && hasAdminOnlyFields(body)) {
		return context.json({ error: 'You can only update your first name and last name' }, 403);
	}

	// Superadmin account: only allow first_name and last_name updates
	if (targetIsSuperadmin) {
		const hasCriticalFields = permitted.username !== undefined ||
			permitted.email !== undefined ||
			permitted.roles !== undefined ||
			permitted.is_active !== undefined ||
			permitted.email_verified === false;
		if (hasCriticalFields) {
			return context.json({ error: 'Superadmin username, email, roles, active status, and email verification cannot be modified' }, 403);
		}
	}

	const { username, email, first_name, last_name, roles, is_active, email_verified } = permitted;

	// Validate fields
	if (username !== undefined && !isValidUsername(username)) {
		return context.json(
			{ error: 'Username must be 3-30 characters, alphanumeric and underscores only' },
			400
		);
	}

	if (email !== undefined && !isValidEmail(email)) {
		return context.json({ error: 'Invalid email format' }, 400);
	}

	if (roles !== undefined) {
		if (!Array.isArray(roles)) {
			return context.json({ error: 'Roles must be an array' }, 400);
		}
		for (const role of roles) {
			if (!isValidRole(role)) {
				return context.json({ error: `Invalid role: ${role}. Valid roles: admin` }, 400);
			}
		}
	}

	// Build update query
	const updates: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (first_name !== undefined) {
		updates.push(`first_name = $${paramIndex++}`);
		params.push(first_name.trim());
	}

	if (last_name !== undefined) {
		updates.push(`last_name = $${paramIndex++}`);
		params.push(last_name.trim());
	}

	if (username !== undefined) {
		updates.push(`username = LOWER($${paramIndex++})`);
		params.push(username);
	}

	if (email !== undefined) {
		updates.push(`email = LOWER($${paramIndex++})`);
		params.push(email);
	}

	if (roles !== undefined) {
		updates.push(`roles = $${paramIndex++}`);
		params.push(roles);
	}

	if (is_active !== undefined) {
		updates.push(`is_active = $${paramIndex++}`);
		params.push(is_active);
		updates.push(is_active ? `deactivated_at = NULL` : `deactivated_at = NOW()`);
	}

	if (email_verified !== undefined) {
		updates.push(`email_verified = $${paramIndex++}`);
		params.push(email_verified);
		updates.push(email_verified ? `email_verified_at = NOW()` : `email_verified_at = NULL`);
	}

	// Check if there's anything to update (user fields or password)
	if (updates.length === 0 && !canSetPassword) {
		return context.json({ error: 'No fields to update' }, 400);
	}

	try {
		// Check for username/email conflicts
		if (username || email) {
			const conflictConditions: string[] = [];
			const conflictParams: unknown[] = [];
			let conflictIndex = 1;

			if (username) {
				conflictConditions.push(`LOWER(username) = LOWER($${conflictIndex++})`);
				conflictParams.push(username);
			}
			if (email) {
				conflictConditions.push(`LOWER(email) = LOWER($${conflictIndex++})`);
				conflictParams.push(email);
			}
			conflictParams.push(id);

			const conflictCheck = await query<{ id: string }>(
				`SELECT id FROM users WHERE (${conflictConditions.join(' OR ')}) AND id != $${conflictIndex}`,
				conflictParams
			);

			if (conflictCheck.rows.length > 0) {
				return context.json({ error: 'Username or email already exists' }, 409);
			}
		}

		let user: User | undefined;

		// Update user fields if any
		if (updates.length > 0) {
			params.push(id);
			const result = await query<User>(
				`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
				params
			);
			user = result.rows[0];
			if (!user) {
				return context.json({ error: 'User not found' }, 404);
			}
		} else {
			// Password-only update - fetch user to return
			const result = await query<User>('SELECT * FROM users WHERE id = $1', [id]);
			user = result.rows[0];
			if (!user) {
				return context.json({ error: 'User not found' }, 404);
			}
		}

		// Update password if superadmin is setting it (validated above)
		// Use UPSERT to handle case where user_passwords record doesn't exist
		if (canSetPassword) {
			const passwordHash = await hashPassword(body.password!);
			await query(
				`INSERT INTO user_passwords (user_id, password_hash)
				 VALUES ($2, $1)
				 ON CONFLICT (user_id) DO UPDATE
				 SET password_hash = EXCLUDED.password_hash`,
				[passwordHash, id]
			);

			// Invalidate all existing sessions for this user (force re-login)
			let cursor = '0';
			do {
				const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100);
				cursor = nextCursor;
				for (const key of keys) {
					const sessionData = await redis.get(key);
					if (sessionData) {
						try {
							const session = JSON.parse(sessionData);
							if (session.userId === id) {
								await redis.del(key);
							}
						} catch {
							// Skip invalid session data
						}
					}
				}
			} while (cursor !== '0');

			console.log(`Password set for user ${id} by superadmin ${currentUser.id}`);
		}

		return context.json(userToApiResponse(user));
	} catch (error) {
		console.error('Failed to update user:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

interface CreateUserRequest {
	username: string;
	email: string;
	password: string;
	first_name: string;
	last_name: string;
	roles?: string[];
}

/**
 * Create a new user (admin only)
 * POST /api/users
 */
export async function handleCreateUser(
	context: Context,
	redis: Redis
): Promise<Response> {
	const currentUser = await getCurrentUser(context, redis);
	if (!currentUser) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	if (!isAdmin(currentUser)) {
		return context.json({ error: 'Admin access required' }, 403);
	}

	let body: CreateUserRequest;
	try {
		body = await context.req.json<CreateUserRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { username, email, password, first_name, last_name, roles = [] } = body;

	// Validate required fields
	if (!username || !email || !password || !first_name || !last_name) {
		return context.json(
			{ error: 'All fields are required: username, email, password, first_name, last_name' },
			400
		);
	}

	if (!isValidUsername(username)) {
		return context.json(
			{ error: 'Username must be 3-30 characters, alphanumeric and underscores only' },
			400
		);
	}

	if (!isValidEmail(email)) {
		return context.json({ error: 'Invalid email format' }, 400);
	}

	if (!Array.isArray(roles)) {
		return context.json({ error: 'Roles must be an array' }, 400);
	}

	for (const role of roles) {
		if (!isValidRole(role)) {
			return context.json({ error: `Invalid role: ${role}. Valid roles: admin` }, 400);
		}
	}

	if (password.length < 8) {
		return context.json({ error: 'Password must be at least 8 characters' }, 400);
	}

	try {
		// Check for existing username/email
		const existingCheck = await query<{ id: string }>(
			'SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
			[username, email]
		);

		if (existingCheck.rows.length > 0) {
			return context.json({ error: 'Username or email already exists' }, 409);
		}

		const passwordHash = await hashPassword(password);

		const userResult = await query<User>(
			`INSERT INTO users (username, email, first_name, last_name, roles, email_verified)
			 VALUES (LOWER($1), LOWER($2), $3, $4, $5, false)
			 RETURNING *`,
			[username, email, first_name.trim(), last_name.trim(), roles]
		);

		const user = userResult.rows[0];
		if (!user) {
			return context.json({ error: 'Failed to create user' }, 500);
		}

		await query(
			'INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)',
			[user.id, passwordHash]
		);

		return context.json(userToApiResponse(user), 201);
	} catch (error) {
		// Handle unique constraint violations (race condition on concurrent creates)
		const pgError = error as { code?: string };
		if (pgError.code === '23505') {
			return context.json({ error: 'Username or email already exists' }, 409);
		}
		console.error('Failed to create user:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/**
 * Get a user's OAuth tokens (admin only, or user viewing own tokens)
 * GET /api/users/:id/tokens
 */
export async function handleListUserTokens(
	context: Context,
	redis: Redis
): Promise<Response> {
	const currentUser = await getCurrentUser(context, redis);
	if (!currentUser) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid user ID format' }, 400);
	}

	// Non-admins can only view their own tokens
	if (!isAdmin(currentUser) && currentUser.id !== id) {
		return context.json({ error: 'Access denied' }, 403);
	}

	try {
		const result = await query<{
			id: string;
			user_id: string;
			client_id: string;
			device_name: string;
			scopes: string[];
			created_at: Date;
			last_used_at: Date | null;
			expires_at: Date;
		}>(
			`SELECT id, user_id, client_id, device_name, scopes, created_at, last_used_at, expires_at
			 FROM mcp_tokens
			 WHERE user_id = $1
			 ORDER BY created_at DESC`,
			[id]
		);

		return context.json({
			tokens: result.rows.map(token => ({
				id: token.id,
				client_id: token.client_id,
				device_name: token.device_name,
				scopes: token.scopes,
				created_at: token.created_at.toISOString(),
				last_used_at: token.last_used_at?.toISOString() ?? null,
				expires_at: token.expires_at.toISOString(),
			})),
		});
	} catch (error) {
		console.error('Failed to list user tokens:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/**
 * Revoke a user's OAuth token
 * DELETE /api/users/:id/tokens/:tokenId
 */
export async function handleRevokeUserToken(
	context: Context,
	redis: Redis
): Promise<Response> {
	const currentUser = await getCurrentUser(context, redis);
	if (!currentUser) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const userId = context.req.param('id');
	const tokenId = context.req.param('tokenId');

	if (!isValidUUID(userId) || !isValidUUID(tokenId)) {
		return context.json({ error: 'Invalid ID format' }, 400);
	}

	// Non-admins can only revoke their own tokens
	if (!isAdmin(currentUser) && currentUser.id !== userId) {
		return context.json({ error: 'Access denied' }, 403);
	}

	try {
		const result = await query(
			'DELETE FROM mcp_tokens WHERE id = $1 AND user_id = $2',
			[tokenId, userId]
		);

		if (result.rowCount === 0) {
			return context.json({ error: 'Token not found' }, 404);
		}

		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to revoke token:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

