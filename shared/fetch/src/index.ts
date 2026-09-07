/**
 * @specboard/fetch
 *
 * Thin fetch wrapper for auth middleware and global error handling.
 */

export { FetchClient, fetchClient } from './client';
export { FetchError } from './types';
export type {
	FetchConfig,
	FetchResponse,
	RequestConfig,
	RequestInterceptor,
	ResponseInterceptor,
	ErrorInterceptor,
} from './types';
