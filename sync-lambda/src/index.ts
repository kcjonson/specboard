/**
 * GitHub Sync Lambda Handler
 *
 * Handles both initial sync (full ZIP download) and incremental sync (changed files only).
 * Invoked asynchronously from the API service when a user triggers a sync.
 */

import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { decrypt, type EncryptedData } from '@specboard/auth/encryption';
import { performInitialSync, type InitialSyncResult } from './initial-sync.ts';
import {
	performIncrementalSync,
	type IncrementalSyncResult,
} from './incremental-sync.ts';

// Secrets Manager client - reused across invocations
const secretsClient = new SecretsManagerClient({});

// Cache for fetched secrets (Lambda container reuse) with TTL
const SECRETS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
interface CachedSecret {
	value: string;
	cachedAt: number;
}
const secretsCache: Map<string, CachedSecret> = new Map();

/**
 * Event structure passed from API to Lambda.
 */
export interface SyncEvent {
	projectId: string;
	userId: string;
	owner: string;
	repo: string;
	branch: string;
	encryptedToken: string; // Encrypted GitHub token (JSON string of EncryptedData)
	mode: 'initial' | 'incremental';
	lastCommitSha?: string; // Required for incremental mode
}

/**
 * Lambda response structure.
 */
export interface SyncResponse {
	success: boolean;
	mode: 'initial' | 'incremental';
	synced: number;
	removed?: number;
	skipped?: number;
	commitSha: string | null;
	error?: string;
}

/**
 * Get environment variables with validation.
 */
function getEnvVar(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

/**
 * Fetch a secret value from AWS Secrets Manager.
 * Caches results for Lambda container reuse efficiency with 5-minute TTL.
 */
async function getSecretValue(secretArn: string): Promise<string> {
	// Check cache first (with TTL)
	const cached = secretsCache.get(secretArn);
	const now = Date.now();
	if (cached && now - cached.cachedAt < SECRETS_CACHE_TTL_MS) {
		return cached.value;
	}

	const response = await secretsClient.send(
		new GetSecretValueCommand({ SecretId: secretArn })
	);

	if (!response.SecretString) {
		throw new Error(`Secret ${secretArn} has no string value`);
	}

	// Cache for future invocations
	secretsCache.set(secretArn, { value: response.SecretString, cachedAt: now });
	return response.SecretString;
}

/**
 * Initialize secrets for sync operations.
 *
 * In local development (when env vars are directly set), skips AWS Secrets Manager.
 * In production (when *_SECRET_ARN env vars are set), fetches from Secrets Manager.
 */
async function initializeSecrets(): Promise<{ storageApiKey: string }> {
	// Local dev mode detection:
	// - NODE_ENV=development, OR
	// - STORAGE_SERVICE_API_KEY is set (only in docker-compose, not Lambda)
	const isLocalDev =
		process.env.NODE_ENV === 'development' ||
		!!process.env.STORAGE_SERVICE_API_KEY;

	if (isLocalDev) {
		const storageApiKey = process.env.STORAGE_SERVICE_API_KEY;
		if (!storageApiKey) {
			throw new Error('Missing STORAGE_SERVICE_API_KEY for local dev');
		}
		if (!process.env.API_KEY_ENCRYPTION_KEY) {
			throw new Error('Missing API_KEY_ENCRYPTION_KEY for local dev');
		}
		console.log('Using local dev secrets (Secrets Manager skipped)');
		return { storageApiKey };
	}

	// Production mode: fetch secrets from AWS Secrets Manager
	const [storageApiKey, encryptionKey, dbCredentialsJson] = await Promise.all([
		getSecretValue(getEnvVar('STORAGE_API_KEY_SECRET_ARN')),
		getSecretValue(getEnvVar('API_KEY_ENCRYPTION_KEY_SECRET_ARN')),
		getSecretValue(getEnvVar('DB_PASSWORD_SECRET_ARN')),
	]);

	// Set encryption key in process.env for @specboard/auth decrypt()
	process.env.API_KEY_ENCRYPTION_KEY = encryptionKey;

	// Parse DB credentials (stored as JSON { username, password })
	// and set DB_PASSWORD for @specboard/db
	try {
		const dbCredentials = JSON.parse(dbCredentialsJson) as { password: string };
		process.env.DB_PASSWORD = dbCredentials.password;
	} catch {
		// Fallback: if it's a plain string, use it directly
		process.env.DB_PASSWORD = dbCredentialsJson;
	}

	return { storageApiKey };
}

/**
 * Lambda handler entry point.
 */
export async function handler(event: SyncEvent): Promise<SyncResponse> {
	console.log('Sync event received:', {
		projectId: event.projectId,
		userId: event.userId,
		owner: event.owner,
		repo: event.repo,
		branch: event.branch,
		mode: event.mode,
		hasLastCommitSha: !!event.lastCommitSha,
	});

	try {
		// Validate required fields
		if (!event.projectId || !event.userId || !event.owner || !event.repo || !event.branch) {
			throw new Error('Missing required event fields');
		}

		if (event.mode === 'incremental' && !event.lastCommitSha) {
			throw new Error('lastCommitSha required for incremental sync');
		}

		// Initialize secrets from AWS Secrets Manager
		const { storageApiKey } = await initializeSecrets();

		// Get storage service URL from environment
		const storageServiceUrl = getEnvVar('STORAGE_SERVICE_URL');

		// Decrypt the GitHub token (uses API_KEY_ENCRYPTION_KEY set by initializeSecrets)
		let token: string;
		try {
			const encrypted: EncryptedData = JSON.parse(event.encryptedToken);
			token = decrypt(encrypted);
		} catch {
			throw new Error('Failed to decrypt GitHub token');
		}

		// Perform sync based on mode
		if (event.mode === 'initial') {
			const result: InitialSyncResult = await performInitialSync(
				{
					projectId: event.projectId,
					owner: event.owner,
					repo: event.repo,
					branch: event.branch,
					token,
				},
				storageServiceUrl,
				storageApiKey
			);

			console.log('Initial sync completed:', result);

			return {
				success: result.success,
				mode: 'initial',
				synced: result.synced,
				skipped: result.skipped,
				commitSha: result.commitSha,
				error: result.error,
			};
		} else {
			const result: IncrementalSyncResult = await performIncrementalSync(
				{
					projectId: event.projectId,
					owner: event.owner,
					repo: event.repo,
					branch: event.branch,
					token,
					lastCommitSha: event.lastCommitSha as string, // Validated at line 141-143
				},
				storageServiceUrl,
				storageApiKey
			);

			console.log('Incremental sync completed:', result);

			return {
				success: result.success,
				mode: 'incremental',
				synced: result.synced,
				removed: result.removed,
				commitSha: result.commitSha,
				error: result.error,
			};
		}
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);

		// Log full error internally for debugging
		console.error('Sync failed:', errorMessage);
		if (err instanceof Error && err.stack) {
			console.error('Stack trace:', err.stack);
		}

		// Return sanitized error message to caller (stored in DB, shown to users)
		// Keep rate limit messages clear, sanitize everything else
		const isRateLimitError = errorMessage.includes('rate limit');
		const sanitizedError = isRateLimitError
			? errorMessage
			: 'Sync failed. Check Lambda logs for details.';

		return {
			success: false,
			mode: event.mode,
			synced: 0,
			commitSha: null,
			error: sanitizedError,
		};
	}
}
