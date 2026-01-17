/**
 * @doc-platform/db - Database module tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to set env vars and mock functions before module import
const { mockQuery, mockConnect, mockEnd, mockOn, mockPoolInstance, MockPool } = vi.hoisted(() => {
	// Set env vars before module loads (required for getDatabaseUrl())
	process.env.DB_HOST = 'localhost';
	process.env.DB_NAME = 'testdb';
	process.env.DB_USER = 'testuser';
	process.env.DB_PASSWORD = 'testpass';

	const mockQuery = vi.fn();
	const mockConnect = vi.fn();
	const mockEnd = vi.fn();
	const mockOn = vi.fn();
	const mockPoolInstance = {
		query: mockQuery,
		connect: mockConnect,
		end: mockEnd,
		on: mockOn,
	};
	const MockPool = vi.fn(() => mockPoolInstance);
	return { mockQuery, mockConnect, mockEnd, mockOn, mockPoolInstance, MockPool };
});

// Mock pg module
vi.mock('pg', () => ({
	default: { Pool: MockPool },
}));

// Mock fs for SSL config
vi.mock('fs', () => ({
	default: {
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(),
	},
}));

// Import after mocks are set up
import { pool, query, getClient, transaction, close } from './index.ts';

describe('@doc-platform/db', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		// Reset the pool state between tests
		await close();
	});

	describe('lazy initialization', () => {
		it('should not create pool on module import', () => {
			// Pool constructor should not have been called yet
			// (it may have been called in previous tests, so we check after close)
			expect(MockPool).not.toHaveBeenCalled();
		});

		it('should create pool on first access to pool.instance', () => {
			const instance = pool.instance;

			expect(MockPool).toHaveBeenCalledTimes(1);
			expect(instance).toBe(mockPoolInstance);
		});

		it('should reuse pool on subsequent accesses', () => {
			const instance1 = pool.instance;
			const instance2 = pool.instance;
			const instance3 = pool.instance;

			expect(MockPool).toHaveBeenCalledTimes(1);
			expect(instance1).toBe(instance2);
			expect(instance2).toBe(instance3);
		});

		it('should register error handler on pool creation', () => {
			pool.instance;

			expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
		});
	});

	describe('query()', () => {
		it('should execute query via pool.instance', async () => {
			const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
			mockQuery.mockResolvedValue(mockResult);

			const result = await query('SELECT * FROM users WHERE id = $1', [1]);

			expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
			expect(result).toBe(mockResult);
		});

		it('should initialize pool on first query', async () => {
			mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

			await query('SELECT 1');

			expect(MockPool).toHaveBeenCalledTimes(1);
		});
	});

	describe('getClient()', () => {
		it('should get client from pool.instance', async () => {
			const mockClient = { query: vi.fn(), release: vi.fn() };
			mockConnect.mockResolvedValue(mockClient);

			const client = await getClient();

			expect(mockConnect).toHaveBeenCalled();
			expect(client).toBe(mockClient);
		});
	});

	describe('transaction()', () => {
		it('should execute function within transaction', async () => {
			const mockClient = {
				query: vi.fn(),
				release: vi.fn(),
			};
			mockConnect.mockResolvedValue(mockClient);

			const result = await transaction(async (client) => {
				await client.query('INSERT INTO users (name) VALUES ($1)', ['test']);
				return 'success';
			});

			expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
			expect(mockClient.query).toHaveBeenCalledWith('INSERT INTO users (name) VALUES ($1)', ['test']);
			expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
			expect(mockClient.release).toHaveBeenCalled();
			expect(result).toBe('success');
		});

		it('should rollback on error', async () => {
			const mockClient = {
				query: vi.fn(),
				release: vi.fn(),
			};
			mockConnect.mockResolvedValue(mockClient);

			const error = new Error('Test error');

			await expect(
				transaction(async () => {
					throw error;
				})
			).rejects.toThrow('Test error');

			expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
			expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
			expect(mockClient.release).toHaveBeenCalled();
		});
	});

	describe('close()', () => {
		it('should close the pool if initialized', async () => {
			// Initialize the pool first
			pool.instance;
			expect(MockPool).toHaveBeenCalledTimes(1);

			await close();

			expect(mockEnd).toHaveBeenCalled();
		});

		it('should allow re-initialization after close', async () => {
			// Initialize
			pool.instance;
			expect(MockPool).toHaveBeenCalledTimes(1);

			// Close
			await close();

			// Re-initialize
			pool.instance;
			expect(MockPool).toHaveBeenCalledTimes(2);
		});

		it('should be safe to call close when pool is not initialized', async () => {
			// Should not throw
			await expect(close()).resolves.toBeUndefined();
		});
	});

	describe('pool configuration', () => {
		it('should pass pool config options when creating pool', () => {
			pool.instance;

			expect(MockPool).toHaveBeenCalledWith(
				expect.objectContaining({
					max: 20,
					idleTimeoutMillis: 30000,
					connectionTimeoutMillis: 2000,
				})
			);
		});
	});
});
