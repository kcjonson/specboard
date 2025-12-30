/**
 * @doc-platform/fetch - FetchClient
 *
 * Thin wrapper around native fetch for:
 * - Auth middleware (request interceptors)
 * - Global error handling (error interceptors)
 * - Reduced boilerplate (base URL, JSON serialization)
 */

import type {
	FetchConfig,
	RequestConfig,
	RequestInterceptor,
	ResponseInterceptor,
	ErrorInterceptor,
} from './types';
import { FetchError } from './types';

export class FetchClient {
	private baseURL: string = '';
	private headers: Record<string, string> = {};
	private requestInterceptors: RequestInterceptor[] = [];
	private responseInterceptors: ResponseInterceptor[] = [];
	private errorInterceptors: ErrorInterceptor[] = [];
	/** In-flight GET requests for deduplication */
	private inFlightRequests: Map<string, Promise<unknown>> = new Map();

	constructor(config?: FetchConfig) {
		if (config?.baseURL) {
			this.baseURL = config.baseURL;
		}
		if (config?.headers) {
			this.headers = { ...config.headers };
		}
	}

	setBaseURL(url: string): void {
		this.baseURL = url;
	}

	setHeader(key: string, value: string): void {
		this.headers[key] = value;
	}

	removeHeader(key: string): void {
		delete this.headers[key];
	}

	addRequestInterceptor(interceptor: RequestInterceptor): () => void {
		this.requestInterceptors.push(interceptor);
		return () => {
			const index = this.requestInterceptors.indexOf(interceptor);
			if (index !== -1) {
				this.requestInterceptors.splice(index, 1);
			}
		};
	}

	addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
		this.responseInterceptors.push(interceptor);
		return () => {
			const index = this.responseInterceptors.indexOf(interceptor);
			if (index !== -1) {
				this.responseInterceptors.splice(index, 1);
			}
		};
	}

	addErrorInterceptor(interceptor: ErrorInterceptor): () => void {
		this.errorInterceptors.push(interceptor);
		return () => {
			const index = this.errorInterceptors.indexOf(interceptor);
			if (index !== -1) {
				this.errorInterceptors.splice(index, 1);
			}
		};
	}

	async get<T>(url: string, config?: Partial<RequestConfig>): Promise<T> {
		// Build cache key from URL and params for deduplication
		const cacheKey = this.buildCacheKey(url, config?.params);

		// Check for in-flight request
		const inFlight = this.inFlightRequests.get(cacheKey);
		if (inFlight) {
			return inFlight as Promise<T>;
		}

		// Create and track the request
		const request = this.request<T>({ ...config, url, method: 'GET' }).finally(() => {
			this.inFlightRequests.delete(cacheKey);
		});

		this.inFlightRequests.set(cacheKey, request);
		return request;
	}

	private buildCacheKey(url: string, params?: Record<string, string | number | boolean>): string {
		let key = url;
		if (params) {
			const sortedParams = Object.entries(params)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => `${k}=${v}`)
				.join('&');
			key += '?' + sortedParams;
		}
		return key;
	}

	async post<T>(url: string, body?: unknown, config?: Partial<RequestConfig>): Promise<T> {
		return this.request<T>({ ...config, url, method: 'POST', body });
	}

	async put<T>(url: string, body?: unknown, config?: Partial<RequestConfig>): Promise<T> {
		return this.request<T>({ ...config, url, method: 'PUT', body });
	}

	async patch<T>(url: string, body?: unknown, config?: Partial<RequestConfig>): Promise<T> {
		return this.request<T>({ ...config, url, method: 'PATCH', body });
	}

	async delete<T>(url: string, config?: Partial<RequestConfig>): Promise<T> {
		return this.request<T>({ ...config, url, method: 'DELETE' });
	}

	async request<T>(config: RequestConfig): Promise<T> {
		let processedConfig = { ...config };

		// Apply request interceptors
		for (const interceptor of this.requestInterceptors) {
			processedConfig = await interceptor(processedConfig);
		}

		// Build URL
		let url = processedConfig.url;
		if (this.baseURL && !url.startsWith('http')) {
			url = this.baseURL + url;
		}

		// Add query params
		if (processedConfig.params) {
			const searchParams = new URLSearchParams();
			for (const [key, value] of Object.entries(processedConfig.params)) {
				searchParams.append(key, String(value));
			}
			url += (url.includes('?') ? '&' : '?') + searchParams.toString();
		}

		// Merge headers (ensure we work with Record<string, string>)
		const configHeaders = (processedConfig.headers ?? {}) as Record<string, string>;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...this.headers,
			...configHeaders,
		};

		// Build fetch options
		const fetchOptions: RequestInit = {
			method: processedConfig.method || 'GET',
			headers,
			credentials: processedConfig.credentials,
			mode: processedConfig.mode,
			cache: processedConfig.cache,
			redirect: processedConfig.redirect,
			referrer: processedConfig.referrer,
			referrerPolicy: processedConfig.referrerPolicy,
			integrity: processedConfig.integrity,
			signal: processedConfig.signal,
		};

		// Serialize body
		if (processedConfig.body !== undefined) {
			fetchOptions.body = JSON.stringify(processedConfig.body);
		}

		try {
			const response = await fetch(url, fetchOptions);

			if (!response.ok) {
				let errorData: unknown;
				try {
					errorData = await response.json();
				} catch {
					// Response body is not JSON
				}
				const error = new FetchError(
					`HTTP ${response.status}: ${response.statusText}`,
					response.status,
					response,
					errorData
				);
				await this.handleError(error);
				throw error;
			}

			// Parse response
			let data: T;

			// Handle 204 No Content and other empty responses
			if (response.status === 204 || response.headers.get('content-length') === '0') {
				data = undefined as T;
			} else {
				const contentType = response.headers.get('content-type');
				if (contentType?.includes('application/json')) {
					data = await response.json() as T;
				} else {
					data = await response.text() as unknown as T;
				}
			}

			// Apply response interceptors
			for (const interceptor of this.responseInterceptors) {
				data = await interceptor(data, response);
			}

			return data;
		} catch (error) {
			if (error instanceof FetchError) {
				throw error;
			}
			// Network error or other failure
			const fetchError = new FetchError(
				error instanceof Error ? error.message : 'Network error',
				0
			);
			await this.handleError(fetchError);
			throw fetchError;
		}
	}

	private async handleError(error: FetchError): Promise<void> {
		for (const interceptor of this.errorInterceptors) {
			await interceptor(error);
		}
	}
}

export const fetchClient = new FetchClient();
