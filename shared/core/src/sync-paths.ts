/**
 * Which paths a cloud project's sync stores. The sync never stores files in these
 * directories (dependencies, build output, editor and tool state), so the API refuses
 * drafts there too: a draft committed into one would be on GitHub but never stored here,
 * leaving a sync point that claims storage is current when it isn't.
 */

/** Directory names skipped anywhere in a path. */
export const SYNC_SKIP_DIRECTORIES: readonly string[] = [
	'node_modules',
	'.git',
	'vendor',
	'dist',
	'build',
	'__pycache__',
	'.next',
	'.nuxt',
	'.cache',
	'coverage',
	'.pytest_cache',
	'.mypy_cache',
	'target', // Rust
	'bin', // Go
	'obj', // .NET
	'.gradle',
	'.idea',
	'.vscode',
];

const SKIPPED = new Set(SYNC_SKIP_DIRECTORIES);

/**
 * Whether a path is inside a skipped directory: one of its directory segments (not the
 * file name itself) is a skipped name. A leading slash is ignored.
 */
export function isInSkippedDirectory(path: string): boolean {
	const segments = path.replace(/^\/+/, '').split('/');
	return segments.slice(0, -1).some((segment) => SKIPPED.has(segment));
}
