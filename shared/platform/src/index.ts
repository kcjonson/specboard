/**
 * @specboard/platform
 * Platform abstraction interfaces for FileSystem, Git, and System.
 */

// Placeholder interfaces - will be implemented per spec
export interface FileSystem {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	readDir(path: string): Promise<string[]>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export interface Git {
	status(): Promise<{ modified: string[]; staged: string[]; untracked: string[] }>;
	add(paths: string[]): Promise<void>;
	commit(message: string): Promise<void>;
	push(): Promise<void>;
	pull(): Promise<void>;
}

export interface System {
	openExternal(url: string): Promise<void>;
	showOpenDialog(options: { directory?: boolean }): Promise<string | null>;
	showSaveDialog(options: { defaultPath?: string }): Promise<string | null>;
}

/**
 * What the desktop preload exposes on `window.platform` (see docs-desktop/src/preload.ts).
 * The browser has no bridge, so its absence is how shared code knows it is running on the
 * web rather than inside a shell with filesystem access.
 */
export interface PlatformBridge {
	openExternal(url: string): Promise<void>;
	showOpenDialog(options: { directory?: boolean }): Promise<string | null>;
}

declare global {
	interface Window {
		platform?: PlatformBridge;
	}
}

/** The desktop bridge, or null in the browser. */
export function getPlatformBridge(): PlatformBridge | null {
	if (typeof window === 'undefined') return null;
	return window.platform ?? null;
}
