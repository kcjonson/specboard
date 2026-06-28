#!/usr/bin/env node
/**
 * Superadmin account seeding script (plain JS - no compilation needed)
 *
 * Creates or updates the single superadmin account.
 * Only the password comes from environment - all other details are fixed.
 */

import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 12;

// Fixed superadmin details - same across all environments
const SUPERADMIN = {
	username: 'superadmin',
	email: 'superadmin@specboard.io',
	firstName: 'Super',
	lastName: 'Admin',
};

function isValidPassword(password) {
	return (
		password.length >= MIN_PASSWORD_LENGTH &&
		/[A-Z]/.test(password) &&
		/[a-z]/.test(password) &&
		/[0-9]/.test(password) &&
		/[^A-Za-z0-9]/.test(password)
	);
}

function getDatabaseUrl() {
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL;
	}

	const host = process.env.DB_HOST;
	const port = process.env.DB_PORT || '5432';
	const name = process.env.DB_NAME;
	const user = process.env.DB_USER;
	const password = process.env.DB_PASSWORD;

	if (host && name && user && password) {
		return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${encodeURIComponent(host)}:${port}/${encodeURIComponent(name)}?sslmode=no-verify`;
	}

	console.error('DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD required');
	process.exit(1);
}

/**
 * Check if running in local development environment
 * LOCAL DEV ONLY: Uses hardcoded password when SUPERADMIN_PASSWORD not set
 */
function isLocalDev() {
	// Only consider local dev if explicitly set or connecting to localhost
	const dbHost = process.env.DB_HOST || '';
	const dbUrl = process.env.DATABASE_URL || '';
	const isLocalHost = dbHost === 'localhost' || dbHost === 'db' || dbUrl.includes('localhost') || dbUrl.includes('@db:');
	const isNotProduction = process.env.NODE_ENV !== 'production';
	const isNotStaging = !process.env.AWS_REGION && !process.env.ECS_CLUSTER;

	return isLocalHost && isNotProduction && isNotStaging;
}

// LOCAL DEV ONLY - hardcoded password for development convenience
// This password is intentionally weak and MUST NEVER be used outside local dev
const LOCAL_DEV_PASSWORD = 'Password123!';

// LOCAL DEV ONLY - a sample project with a realistic spread of work items so the
// planning board and table views have meaningful data to render (all statuses,
// all item types, and epics both with and without tasks).
const SAMPLE_PROJECT = {
	name: 'Sample Project',
	description: 'Seeded sample data for local development',
};

/**
 * Epics for the sample project. `tasks` exercises the table's tree view:
 * some epics have tasks across statuses, others have none (no expand chevron).
 */
const SAMPLE_EPICS = [
	{
		title: 'User authentication',
		type: 'epic',
		status: 'in_progress',
		description: 'Email/password and OAuth sign-in.',
		tasks: [
			{ title: 'Login form', status: 'done' },
			{ title: 'OAuth providers', status: 'in_progress' },
			{ title: 'Password reset', status: 'ready' },
			{ title: 'Multi-factor auth', status: 'blocked' },
		],
	},
	{
		title: 'Checkout flow',
		type: 'epic',
		status: 'in_progress',
		description: 'Cart, payment, and order confirmation.',
		tasks: [],
	},
	{
		title: 'Search & filtering',
		type: 'epic',
		status: 'ready',
		description: 'Full-text search with faceted filters.',
		tasks: [
			{ title: 'Indexing pipeline', status: 'ready' },
			{ title: 'Filter UI', status: 'ready' },
		],
	},
	{
		title: 'Navbar overflows on mobile',
		type: 'bug',
		status: 'ready',
		description: 'Links wrap and clip under 360px width.',
		tasks: [],
	},
	{
		title: 'Upgrade dependencies',
		type: 'epic',
		status: 'ready',
		description: 'Bump Preact, Vite, and TypeScript.',
		tasks: [
			{ title: 'Bump Preact', status: 'done' },
			{ title: 'Bump Vite', status: 'ready' },
		],
	},
	{
		title: 'Project scaffolding',
		type: 'epic',
		status: 'done',
		description: 'Monorepo, tooling, and CI setup.',
		tasks: [
			{ title: 'Repo setup', status: 'done' },
			{ title: 'CI pipeline', status: 'done' },
		],
	},
	{
		title: 'Landing page',
		type: 'epic',
		status: 'done',
		description: 'Marketing landing page.',
		tasks: [],
	},
];

/**
 * Seed a sample project (LOCAL DEV ONLY). Idempotent: if a project with the
 * sample name already exists for this owner, seeding is skipped so re-running
 * the seed never creates duplicates.
 */
async function seedSampleProject(pool, ownerId) {
	const existing = await pool.query(
		'SELECT id FROM projects WHERE name = $1 AND owner_id = $2',
		[SAMPLE_PROJECT.name, ownerId]
	);
	if (existing.rows[0]) {
		console.log('Sample project already exists. Skipping sample data seed.');
		return;
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const projectResult = await client.query(
			`INSERT INTO projects (name, description, owner_id)
			 VALUES ($1, $2, $3) RETURNING id`,
			[SAMPLE_PROJECT.name, SAMPLE_PROJECT.description, ownerId]
		);
		const projectId = projectResult.rows[0]?.id;
		if (!projectId) {
			throw new Error('Failed to create sample project');
		}

		for (let i = 0; i < SAMPLE_EPICS.length; i++) {
			const epic = SAMPLE_EPICS[i];
			const epicResult = await client.query(
				`INSERT INTO epics (project_id, title, description, status, type, rank, creator)
				 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
				[projectId, epic.title, epic.description, epic.status, epic.type, i + 1, ownerId]
			);
			const epicId = epicResult.rows[0]?.id;
			if (!epicId) {
				throw new Error('Failed to create sample epic');
			}

			for (let j = 0; j < epic.tasks.length; j++) {
				const task = epic.tasks[j];
				await client.query(
					`INSERT INTO tasks (epic_id, title, status, rank)
					 VALUES ($1, $2, $3, $4)`,
					[epicId, task.title, task.status, j + 1]
				);
			}
		}

		await client.query('COMMIT');
		console.log(`Sample project seeded with ${SAMPLE_EPICS.length} epics`);
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

async function seed() {
	let password = process.env.SUPERADMIN_PASSWORD;

	// LOCAL DEV ONLY: Use hardcoded password if not set
	if (!password && isLocalDev()) {
		console.log('LOCAL DEV: Using default superadmin password');
		password = LOCAL_DEV_PASSWORD;
	}

	if (!password) {
		console.log('SUPERADMIN_PASSWORD not set. Skipping seed.');
		return;
	}

	if (!isValidPassword(password)) {
		console.error('Invalid password: min 12 chars, must have uppercase, lowercase, digit, special char');
		process.exit(1);
	}

	const pool = new Pool({ connectionString: getDatabaseUrl() });

	try {
		const tableCheck = await pool.query(`
			SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') AS users_exists,
			       EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_passwords') AS passwords_exists
		`);

		const tableStatus = tableCheck.rows[0];
		if (!tableStatus || !tableStatus.users_exists || !tableStatus.passwords_exists) {
			console.log('Required tables do not exist. Run migrations first.');
			return;
		}

		const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

		// Check if superadmin exists
		const existing = await pool.query(
			'SELECT id FROM users WHERE username = $1',
			[SUPERADMIN.username]
		);

		let superadminId;
		if (existing.rows[0]) {
			// Update password and ensure admin role
			superadminId = existing.rows[0].id;
			await pool.query(
				'UPDATE user_passwords SET password_hash = $1 WHERE user_id = $2',
				[passwordHash, superadminId]
			);
			// Ensure admin role is set
			await pool.query(
				`UPDATE users SET roles = ARRAY['admin'] WHERE id = $1 AND NOT ('admin' = ANY(roles))`,
				[superadminId]
			);
			console.log('Superadmin password updated');
		} else {
			// Create superadmin
			console.log('Creating superadmin account...');

			const client = await pool.connect();
			try {
				await client.query('BEGIN');

				const userResult = await client.query(
					`INSERT INTO users (username, first_name, last_name, email, email_verified, roles)
					 VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
					[SUPERADMIN.username, SUPERADMIN.firstName, SUPERADMIN.lastName, SUPERADMIN.email, ['admin']]
				);

				superadminId = userResult.rows[0]?.id;
				if (!superadminId) {
					throw new Error('Failed to create user record');
				}

				await client.query(
					'INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)',
					[superadminId, passwordHash]
				);

				await client.query('COMMIT');
				console.log('Superadmin account created');
			} catch (err) {
				await client.query('ROLLBACK');
				throw err;
			} finally {
				client.release();
			}
		}

		// LOCAL DEV ONLY: seed a sample project with realistic work items.
		if (superadminId && isLocalDev()) {
			await seedSampleProject(pool, superadminId);
		}
	} finally {
		await pool.end();
	}
}

seed().catch((err) => {
	console.error('Seed failed:', err instanceof Error ? err.message : 'Unknown error');
	process.exit(1);
});
