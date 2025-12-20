/**
 * @doc-platform/models - Type definitions
 */

export type ChangeCallback = () => void;

export interface ModelMeta {
	working: boolean;
	error: Error | null;
	lastFetched: number | null;
	[key: string]: unknown;
}
