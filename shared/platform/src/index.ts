/**
 * @doc-platform/platform
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
