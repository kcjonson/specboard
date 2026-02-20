/**
 * @specboard/fetch - Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetchClient, FetchError } from './index';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('FetchClient', () => {
	let client: FetchClient;

	beforeEach(() => {
		client = new FetchClient();
		mockFetch.mockReset();
	});

	describe('configuration', () => {
		it('should set base URL', () => {
			client.setBaseURL('https://api.example.com');
			// Base URL is applied in request
		});

		it('should set headers', () => {
			client.setHeader('Authorization', 'Bearer token');
			client.setHeader('X-Custom', 'value');
		});

		it('should remove headers', () => {
			client.setHeader('X-Custom', 'value');
			client.removeHeader('X-Custom');
		});
	});

	describe('HTTP methods', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: () => Promise.resolve({ data: 'test' }),
			});
		});

		it('should make GET requests', async () => {
			const result = await client.get<{ data: string }>('/test');

			expect(mockFetch).toHaveBeenCalledWith(
				'/test',
				expect.objectContaining({ method: 'GET' })
			);
			expect(result).toEqual({ data: 'test' });
		});

		it('should make POST requests with body', async () => {
			await client.post('/test', { name: 'John' });

			expect(mockFetch).toHaveBeenCalledWith(
				'/test',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ name: 'John' }),
				})
			);
		});

		it('should make PUT requests', async () => {
			await client.put('/test', { id: 1, name: 'John' });

			expect(mockFetch).toHaveBeenCalledWith(
				'/test',
				expect.objectContaining({ method: 'PUT' })
			);
		});

		it('should make PATCH requests', async () => {
			await client.patch('/test', { name: 'Jane' });

			expect(mockFetch).toHaveBeenCalledWith(
				'/test',
				expect.objectContaining({ method: 'PATCH' })
			);
		});

		it('should make DELETE requests', async () => {
			await client.delete('/test');

			expect(mockFetch).toHaveBeenCalledWith(
				'/test',
				expect.objectContaining({ method: 'DELETE' })
			);
		});
	});

	describe('URL handling', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: () => Promise.resolve({}),
			});
		});

		it('should prepend base URL', async () => {
			client.setBaseURL('https://api.example.com');
			await client.get('/users');

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/users',
				expect.any(Object)
			);
		});

		it('should add query params', async () => {
			await client.get('/users', { params: { page: 1, limit: 10 } });

			expect(mockFetch).toHaveBeenCalledWith(
				'/users?page=1&limit=10',
				expect.any(Object)
			);
		});
	});

	describe('interceptors', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: () => Promise.resolve({ original: true }),
			});
		});

		it('should apply request interceptors', async () => {
			client.addRequestInterceptor((config) => ({
				...config,
				headers: { ...config.headers, 'X-Intercepted': 'true' } as Record<string, string>,
			}));

			await client.get('/test');

			expect(mockFetch).toHaveBeenCalledWith(
				'/test',
				expect.objectContaining({
					headers: expect.objectContaining({ 'X-Intercepted': 'true' }),
				})
			);
		});

		it('should apply response interceptors', async () => {
			client.addResponseInterceptor(<T>(data: T) => {
				return { ...data as object, intercepted: true } as T;
			});

			const result = await client.get<{ original: boolean; intercepted: boolean }>('/test');

			expect(result.intercepted).toBe(true);
		});

		it('should call error interceptors on failure', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				statusText: 'Not Found',
				headers: new Headers(),
				json: () => Promise.resolve({ error: 'Not found' }),
			});

			const errorHandler = vi.fn();
			client.addErrorInterceptor(errorHandler);

			await expect(client.get('/not-found')).rejects.toThrow(FetchError);
			expect(errorHandler).toHaveBeenCalled();
		});

		it('should allow removing interceptors', async () => {
			const interceptor = vi.fn((config) => config);
			const unsubscribe = client.addRequestInterceptor(interceptor);

			await client.get('/test');
			expect(interceptor).toHaveBeenCalledTimes(1);

			unsubscribe();
			await client.get('/test');
			expect(interceptor).toHaveBeenCalledTimes(1); // Not called again
		});
	});

	describe('error handling', () => {
		it('should throw FetchError on non-ok response', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				headers: new Headers(),
				json: () => Promise.resolve({ message: 'Server error' }),
			});

			await expect(client.get('/error')).rejects.toThrow(FetchError);
		});

		it('should include status in FetchError', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				headers: new Headers(),
				json: () => Promise.resolve({}),
			});

			try {
				await client.get('/protected');
			} catch (error) {
				expect(error).toBeInstanceOf(FetchError);
				expect((error as FetchError).status).toBe(401);
			}
		});

		it('should handle network errors', async () => {
			mockFetch.mockRejectedValue(new Error('Network failure'));

			await expect(client.get('/test')).rejects.toThrow(FetchError);
		});
	});
});
