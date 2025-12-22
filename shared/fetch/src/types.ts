/**
 * @doc-platform/fetch - Type definitions
 */

export interface FetchConfig {
	baseURL?: string;
	headers?: Record<string, string>;
}

export interface RequestConfig extends Omit<RequestInit, 'body'> {
	url: string;
	params?: Record<string, string | number | boolean>;
	body?: unknown;
}

export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
export type ResponseInterceptor = <T>(data: T, response: Response) => T | Promise<T>;
export type ErrorInterceptor = (error: FetchError) => void | Promise<void>;

export class FetchError extends Error {
	constructor(
		message: string,
		public status: number,
		public response?: Response,
		public data?: unknown
	) {
		super(message);
		this.name = 'FetchError';
	}
}
