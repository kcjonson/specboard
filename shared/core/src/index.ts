/**
 * @doc-platform/core
 * Shared types and utilities used across the platform.
 */

export const VERSION = '0.0.1';

// Planning types
export type Status = 'ready' | 'in_progress' | 'done';

export interface Task {
	id: string;
	epicId: string;
	title: string;
	status: Status;
	assignee?: string;
	dueDate?: string;
	rank: number;
}

export interface TaskStats {
	total: number;
	done: number;
}

export interface Epic {
	id: string;
	title: string;
	description?: string;
	status: Status;
	assignee?: string;
	rank: number;
	createdAt: string;
	updatedAt: string;
	taskStats?: TaskStats;
	tasks?: Task[];
}

/**
 * Creates a unique identifier.
 */
export function createId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Deep clones an object.
 */
export function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

/**
 * Debounces a function call.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	ms: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timeoutId) clearTimeout(timeoutId);
		timeoutId = setTimeout(() => fn(...args), ms);
	};
}
