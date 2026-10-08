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
	/** Cloud: the committed version's hash, which a tree delete or rename sends as its base. */
	contentHash?: string;
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
	/** Cloud drafts: what's committed at this path changed since the draft began. */
	conflict?: boolean;
	/** Cloud drafts: a deletion that is the old side of a rename, and where the file went. */
	renamedTo?: string;
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
/**
 * A file as the editor opens it. `baseContentHash` is the committed version the content
 * comes from (cloud projects): the committed file's hash, or for one of the caller's
 * drafts, the version the draft was made against; null when nothing is committed there.
 * Absent where there's no committed copy to compare against (local projects).
 */
export interface OpenedDocument {
	content: string;
	baseContentHash?: string | null;
}

export interface StorageProvider {
	// File operations
	listDirectory(relativePath: string, options?: ListDirectoryOptions): Promise<FileEntry[]>;
	readFile(relativePath: string): Promise<string>;
	/** readFile, plus what the content was made against, for an editor that will save it back. */
	readDocument(relativePath: string): Promise<OpenedDocument>;
	/**
	 * `baseContentHash` is what the content was made against, as readDocument gave it
	 * (null: nothing committed). Undefined when the writer doesn't know (an agent, a
	 * script), which takes what's committed at the path now.
	 */
	writeFile(relativePath: string, content: string, baseContentHash?: string | null): Promise<void>;
	/** `baseContentHash`: what the caller last saw of the file, as for writeFile. */
	deleteFile(relativePath: string, baseContentHash?: string | null): Promise<void>;
	createDirectory(relativePath: string): Promise<void>;
	/** `sourceBaseContentHash`: what the caller last saw of the file being renamed. */
	rename(oldPath: string, newPath: string, sourceBaseContentHash?: string | null): Promise<void>;
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

