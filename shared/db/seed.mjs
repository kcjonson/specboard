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

async function seed() {
	const password = process.env.SUPERADMIN_PASSWORD;

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

		if (existing.rows[0]) {
			// Update password
			const userId = existing.rows[0].id;
			await pool.query(
				'UPDATE user_passwords SET password_hash = $1 WHERE user_id = $2',
				[passwordHash, userId]
			);
			console.log('Superadmin password updated');
			return;
		}

		// Create superadmin
		console.log('Creating superadmin account...');

		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			const userResult = await client.query(
				`INSERT INTO users (username, first_name, last_name, email, email_verified)
				 VALUES ($1, $2, $3, $4, true) RETURNING id`,
				[SUPERADMIN.username, SUPERADMIN.firstName, SUPERADMIN.lastName, SUPERADMIN.email]
			);

			const userId = userResult.rows[0]?.id;
			if (!userId) {
				throw new Error('Failed to create user record');
			}

			await client.query(
				'INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)',
				[userId, passwordHash]
			);

			await client.query('COMMIT');
			console.log('Superadmin account created');
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

seed().catch((err) => {
	console.error('Seed failed:', err instanceof Error ? err.message : 'Unknown error');
	process.exit(1);
});
