#!/usr/bin/env node
/**
 * Admin account seeding script (plain JS - no compilation needed)
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 12;

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
	return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

function isValidPassword(password) {
	return (
		password.length >= MIN_PASSWORD_LENGTH &&
		/[A-Z]/.test(password) &&
		/[a-z]/.test(password) &&
		/[0-9]/.test(password) &&
		/[^A-Za-z0-9]/.test(password)
	);
}

function isValidName(name) {
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= 255;
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

function getAdminConfig() {
	if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && process.env.ADMIN_EMAIL) {
		console.log('Using admin config from environment variables');
		return {
			username: process.env.ADMIN_USERNAME,
			password: process.env.ADMIN_PASSWORD,
			email: process.env.ADMIN_EMAIL,
			firstName: process.env.ADMIN_FIRST_NAME || 'Admin',
			lastName: process.env.ADMIN_LAST_NAME || 'User',
		};
	}

	const configPaths = [
		path.join(import.meta.dirname, '../../seed.local.json'),
		path.join(process.cwd(), 'seed.local.json'),
	];

	for (const configPath of configPaths) {
		if (fs.existsSync(configPath)) {
			try {
				const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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
			} catch {
				console.warn(`Failed to parse ${configPath}`);
			}
		}
	}

	return null;
}

async function seed() {
	const adminConfig = getAdminConfig();

	if (!adminConfig) {
		console.log('No admin configuration found. Skipping seed.');
		return;
	}

	if (!isValidUsername(adminConfig.username)) {
		console.error('Invalid username: must be 3-30 chars, alphanumeric and underscores');
		process.exit(1);
	}

	if (!isValidEmail(adminConfig.email)) {
		console.error('Invalid email address');
		process.exit(1);
	}

	if (!isValidPassword(adminConfig.password)) {
		console.error('Invalid password: min 12 chars, must have uppercase, lowercase, digit, special char');
		process.exit(1);
	}

	if (!isValidName(adminConfig.firstName) || !isValidName(adminConfig.lastName)) {
		console.error('Invalid name: first and last name must be non-empty and max 255 chars');
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

		const existing = await pool.query(
			'SELECT id, username, email FROM users WHERE username = $1 OR email = $2',
			[adminConfig.username.toLowerCase(), adminConfig.email.toLowerCase()]
		);

		if (existing.rows[0]) {
			const match = existing.rows[0];
			if (match.username === adminConfig.username.toLowerCase() && match.email === adminConfig.email.toLowerCase()) {
				console.log(`Admin user already exists: ${match.username}`);
			} else if (match.username === adminConfig.username.toLowerCase()) {
				console.log(`Username '${adminConfig.username}' already taken by another user`);
			} else {
				console.log(`Email '${adminConfig.email}' already registered to user '${match.username}'`);
			}
			return;
		}

		console.log('Creating admin account...');
		const passwordHash = await bcrypt.hash(adminConfig.password, BCRYPT_COST);

		const client = await pool.connect();
		try {
			await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

			const txnCheck = await client.query(
				'SELECT id FROM users WHERE username = $1 OR email = $2',
				[adminConfig.username.toLowerCase(), adminConfig.email.toLowerCase()]
			);

			if (txnCheck.rows[0]) {
				await client.query('ROLLBACK');
				console.log('Admin user was created by another process');
				return;
			}

			const userResult = await client.query(
				`INSERT INTO users (username, first_name, last_name, email, email_verified)
				 VALUES ($1, $2, $3, $4, true) RETURNING id`,
				[adminConfig.username.toLowerCase(), adminConfig.firstName.trim(), adminConfig.lastName.trim(), adminConfig.email.toLowerCase()]
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
			console.log(`Created admin user: ${adminConfig.username}`);
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
