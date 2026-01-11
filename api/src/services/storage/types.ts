/**
 * Storage provider types
 * See /docs/specs/project-storage.md for full specification
 */

// Limits to prevent performance issues
export const STORAGE_LIMITS = {
	MAX_FILES_PER_LISTING: 1000,
	MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
	MAX_TOTAL_SIZE_BYTES: 50 * 1024 * 1024, // 50MB total for a project
} as const;

export interface FileEntry {
	name: string;
	path: string; // Relative to repo root
	type: 'file' | 'directory';
	size?: number;
	modifiedAt?: Date;
}

export interface ListDirectoryOptions {
	/** Show hidden files (starting with .) - default: false */
	showHidden?: boolean;
	/** Filter to specific file extensions (e.g., ['md', 'mdx']) - directories always included */
	extensions?: string[];
}

export interface GitStatus {
	branch: string;
	ahead: number;
	behind: number;
	staged: FileChange[];
	unstaged: FileChange[];
	untracked: string[];
}

export interface FileChange {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	oldPath?: string; // For renames
}

export interface Commit {
	sha: string;
	shortSha: string;
	message: string;
	author: {
		name: string;
		email: string;
	};
	date: Date;
}

export interface PullResult {
	pulled: boolean;
	commits: number;
	conflicts: string[];
}

/**
 * Storage provider interface
 * Implementations: LocalStorageProvider, GitStorageProvider (cloud)
 */
export interface StorageProvider {
	// File operations
	listDirectory(relativePath: string, options?: ListDirectoryOptions): Promise<FileEntry[]>;
	readFile(relativePath: string): Promise<string>;
	writeFile(relativePath: string, content: string): Promise<void>;
	deleteFile(relativePath: string): Promise<void>;
	createDirectory(relativePath: string): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	exists(relativePath: string): Promise<boolean>;

	// Git operations
	status(): Promise<GitStatus>;
	log(options?: { limit?: number; path?: string }): Promise<Commit[]>;
	add(paths: string[]): Promise<void>;
	commit(message: string): Promise<string>; // Returns commit SHA
	push(): Promise<void>;
	pull(): Promise<PullResult>;
	restore(relativePath: string): Promise<void>; // Restore deleted file from git

	// Repository info
	getCurrentBranch(): Promise<string>;
	getRemoteUrl(): Promise<string | null>;
}

