/**
 * Admin account seeding script
 *
 * Creates an admin account if one doesn't exist.
 * Credentials are read from:
 * 1. Environment variables (for deployed environments via GitHub Secrets)
 * 2. Local config file at project root (for local development)
 *
 * Environment variables:
 * - ADMIN_USERNAME (required, 3-30 chars, alphanumeric + underscores, will be lowercased)
 * - ADMIN_PASSWORD (required, min 12 chars, must have uppercase, lowercase, digit, special char)
 * - ADMIN_EMAIL (required, valid email format, will be lowercased)
 * - ADMIN_FIRST_NAME (optional, defaults to "Admin")
 * - ADMIN_LAST_NAME (optional, defaults to "User")
 *
 * Local config file: seed.local.json (gitignored)
 * {
 *   "admin": {
 *     "username": "admin",
 *     "password": "YourSecurePassword123!",
 *     "email": "admin@example.com",
 *     "firstName": "Admin",
 *     "lastName": "User"
 *   }
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { hashPassword, validatePassword } from '@doc-platform/auth';

const { Pool } = pg;

interface AdminConfig {
	username: string;
	password: string;
	email: string;
	firstName: string;
	lastName: string;
}

interface LocalConfig {
	admin: {
		username: string;
		password: string;
		email: string;
		firstName?: string;
		lastName?: string;
	};
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate username: 3-30 chars, alphanumeric and underscores only
 */
function isValidUsername(username: string): boolean {
	return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

function getDatabaseUrl(): string {
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL;
	}

	const host = process.env.DB_HOST;
	const port = process.env.DB_PORT || '5432';
	const name = process.env.DB_NAME;
	const user = process.env.DB_USER;
	const password = process.env.DB_PASSWORD;

	if (host && name && user && password) {
		const encodedUser = encodeURIComponent(user);
		const encodedPassword = encodeURIComponent(password);
		const encodedHost = encodeURIComponent(host);
		const encodedName = encodeURIComponent(name);
		return `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodedName}?sslmode=no-verify`;
	}

	console.error(
		'DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD required'
	);
	process.exit(1);
}

function getAdminConfig(): AdminConfig | null {
	// First, try environment variables (GitHub Secrets for deployed environments)
	if (
		process.env.ADMIN_USERNAME &&
		process.env.ADMIN_PASSWORD &&
		process.env.ADMIN_EMAIL
	) {
		console.log('Using admin config from environment variables');
		return {
			username: process.env.ADMIN_USERNAME,
			password: process.env.ADMIN_PASSWORD,
			email: process.env.ADMIN_EMAIL,
			firstName: process.env.ADMIN_FIRST_NAME || 'Admin',
			lastName: process.env.ADMIN_LAST_NAME || 'User',
		};
	}

	// Second, try local config file (for local development)
	// Look in project root (go up from shared/db/src)
	const configPaths = [
		path.join(import.meta.dirname, '../../../seed.local.json'),
		path.join(process.cwd(), 'seed.local.json'),
	];

	for (const configPath of configPaths) {
		if (fs.existsSync(configPath)) {
			try {
				const content = fs.readFileSync(configPath, 'utf-8');
				const config = JSON.parse(content) as LocalConfig;

				if (config.admin?.username && config.admin?.password && config.admin?.email) {
					console.log(`Using admin config from ${configPath}`);
					return {
						username: config.admin.username,
						password: config.admin.password,
						email: config.admin.email,
						firstName: config.admin.firstName || 'Admin',
						lastName: config.admin.lastName || 'User',
					};
				}
			} catch (err) {
				console.warn(`Failed to parse ${configPath}:`, err);
			}
		}
	}

	return null;
}

async function seed(): Promise<void> {
	const adminConfig = getAdminConfig();

	if (!adminConfig) {
		console.log('No admin configuration found. Skipping seed.');
		console.log('To seed an admin account, either:');
		console.log(
			'  1. Set ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL environment variables'
		);
		console.log('  2. Create seed.local.json in project root (see seed.local.example.json)');
		return;
	}

	// Validate input before proceeding
	const validationErrors: string[] = [];

	if (!isValidUsername(adminConfig.username)) {
		validationErrors.push('Username must be 3-30 characters, alphanumeric and underscores only');
	}

	if (!isValidEmail(adminConfig.email)) {
		validationErrors.push('Email address is not valid');
	}

	const passwordValidation = validatePassword(adminConfig.password);
	if (!passwordValidation.valid) {
		for (const error of passwordValidation.errors) {
			validationErrors.push(error.message);
		}
	}

	if (validationErrors.length > 0) {
		console.error('Invalid admin configuration:');
		for (const error of validationErrors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}

	const databaseUrl = getDatabaseUrl();
	const pool = new Pool({ connectionString: databaseUrl });

	try {
		// Check if the required tables exist (migrations may not have run yet)
		const tableCheck = await pool.query(`
			SELECT
				(SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')) AS users_exists,
				(SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_passwords')) AS passwords_exists
		`);

		const { users_exists, passwords_exists } = tableCheck.rows[0];
		if (!users_exists || !passwords_exists) {
			console.log('Required tables do not exist. Run migrations first.');
			return;
		}

		// Check if admin already exists by username or email
		const existingUser = await pool.query<{ id: string; username: string }>(
			'SELECT id, username FROM users WHERE username = $1 OR email = $2',
			[adminConfig.username.toLowerCase(), adminConfig.email.toLowerCase()]
		);

		const existing = existingUser.rows[0];
		if (existing) {
			console.log(
				`Admin user already exists: ${existing.username} (id: ${existing.id})`
			);
			return;
		}

		// Hash the password
		console.log('Creating admin account...');
		const passwordHash = await hashPassword(adminConfig.password);

		// Create the admin user in a transaction
		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			// Insert user
			const userResult = await client.query<{ id: string }>(
				`INSERT INTO users (username, first_name, last_name, email, email_verified)
				 VALUES ($1, $2, $3, $4, true)
				 RETURNING id`,
				[
					adminConfig.username.toLowerCase(),
					adminConfig.firstName,
					adminConfig.lastName,
					adminConfig.email.toLowerCase(),
				]
			);
			const newUser = userResult.rows[0];
			if (!newUser) {
				throw new Error('Failed to create user');
			}
			const userId = newUser.id;

			// Insert password
			await client.query(
				'INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)',
				[userId, passwordHash]
			);

			await client.query('COMMIT');
			console.log(`✓ Created admin user: ${adminConfig.username} (id: ${userId})`);
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} finally {
		await pool.end();
	}
}

seed().catch((err: unknown) => {
	// Sanitize error output to avoid leaking sensitive data (passwords, connection strings)
	const message = err instanceof Error ? err.message : 'Unknown error';
	console.error('Seed failed:', message);
	process.exit(1);
});
