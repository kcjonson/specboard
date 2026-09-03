/**
 * @specboard/fetch - Type definitions
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
	status: number;
	response?: Response;
	data?: unknown;

	constructor(message: string, status: number, response?: Response, data?: unknown) {
		super(message);
		this.name = 'FetchError';
		this.status = status;
		this.response = response;
		this.data = data;
	}
}
