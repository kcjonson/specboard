/**
 * File type detection for GitHub sync.
 * Determines which files to sync (text/source) and which to skip (binary).
 */

// Text file extensions that should be synced
const TEXT_EXTENSIONS = new Set([
	// Documentation
	'md',
	'mdx',
	'txt',
	'rst',
	'adoc',
	// Config
	'json',
	'yaml',
	'yml',
	'toml',
	'xml',
	'ini',
	'env',
	'env.example',
	'env.local',
	// JavaScript/TypeScript
	'js',
	'jsx',
	'ts',
	'tsx',
	'mjs',
	'cjs',
	// Other languages
	'py',
	'rb',
	'go',
	'rs',
	'java',
	'kt',
	'scala',
	'c',
	'cpp',
	'h',
	'hpp',
	'cs',
	'php',
	'swift',
	'sh',
	'bash',
	'zsh',
	'sql',
	'graphql',
	'prisma',
	// Web
	'html',
	'htm',
	'css',
	'scss',
	'sass',
	'less',
	'vue',
	'svelte',
	// Special files (no extension or special names)
	'gitignore',
	'gitattributes',
	'editorconfig',
	'dockerignore',
	'eslintignore',
	'prettierignore',
]);

// Binary file extensions that should be skipped
const BINARY_EXTENSIONS = new Set([
	// Images
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'svg',
	'ico',
	'bmp',
	'tiff',
	'psd',
	// Media
	'mp3',
	'mp4',
	'wav',
	'avi',
	'mov',
	'webm',
	'ogg',
	'flac',
	// Archives
	'zip',
	'tar',
	'gz',
	'rar',
	'7z',
	'bz2',
	// Fonts
	'woff',
	'woff2',
	'ttf',
	'otf',
	'eot',
	// Binaries
	'exe',
	'dll',
	'so',
	'dylib',
	'o',
	'a',
	'class',
	'pyc',
	'pyo',
	// Documents (often binary)
	'pdf',
	'doc',
	'docx',
	'xls',
	'xlsx',
	'ppt',
	'pptx',
	// Data
	'db',
	'sqlite',
	'sqlite3',
	// Lock files (can be very large, often auto-generated)
	'lock',
]);

// Directories to always skip
const SKIP_DIRECTORIES = [
	'node_modules/',
	'.git/',
	'vendor/',
	'dist/',
	'build/',
	'__pycache__/',
	'.next/',
	'.nuxt/',
	'.cache/',
	'coverage/',
	'.pytest_cache/',
	'.mypy_cache/',
	'target/', // Rust
	'bin/', // Go
	'obj/', // .NET
	'.gradle/',
	'.idea/',
	'.vscode/',
];

// Special filenames that are text files (no extension)
const SPECIAL_TEXT_FILES = new Set([
	'Dockerfile',
	'Makefile',
	'Rakefile',
	'Gemfile',
	'Procfile',
	'LICENSE',
	'LICENCE',
	'README',
	'CHANGELOG',
	'CONTRIBUTING',
	'AUTHORS',
	'CODEOWNERS',
]);

/**
 * Get the extension from a file path.
 */
function getExtension(path: string): string {
	const filename = path.split('/').pop() || '';
	const lastDot = filename.lastIndexOf('.');

	// No dot or dot at start (hidden file like .gitignore)
	if (lastDot <= 0) {
		// Check if it's a dotfile like .gitignore
		if (filename.startsWith('.')) {
			return filename.substring(1).toLowerCase();
		}
		return '';
	}

	return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * Get the filename without path.
 */
function getFilename(path: string): string {
	return path.split('/').pop() || '';
}

/**
 * Check if a path should be skipped because it's in a skip directory.
 */
export function shouldSkipDirectory(path: string): boolean {
	const normalizedPath = path.startsWith('/') ? path.substring(1) : path;

	for (const dir of SKIP_DIRECTORIES) {
		if (normalizedPath.includes(dir)) {
			return true;
		}
	}

	return false;
}

/**
 * Check if a file is a text file that should be synced.
 * Uses extension-based detection with special case handling.
 */
export function isTextFile(path: string): boolean {
	// Skip files in ignored directories
	if (shouldSkipDirectory(path)) {
		return false;
	}

	const filename = getFilename(path);
	const ext = getExtension(path);

	// Check special text filenames (no extension)
	if (!ext && SPECIAL_TEXT_FILES.has(filename)) {
		return true;
	}

	// Check if it's a known binary extension
	if (BINARY_EXTENSIONS.has(ext)) {
		return false;
	}

	// Check if it's a known text extension
	if (TEXT_EXTENSIONS.has(ext)) {
		return true;
	}

	// For unknown extensions, default to skipping
	// This is safer than accidentally syncing binary files
	return false;
}

/**
 * Check if a file is editable in the documentation editor.
 * Only markdown files are editable; other text files are read-only for AI reference.
 */
export function isEditableFile(path: string): boolean {
	const ext = getExtension(path);
	return ext === 'md' || ext === 'mdx';
}

/**
 * Strip the root folder from a GitHub ZIP path.
 * GitHub ZIPs contain a root folder like: my-repo-abc123/docs/file.md
 * We want: docs/file.md
 */
export function stripRootFolder(zipPath: string): string {
	const firstSlash = zipPath.indexOf('/');
	if (firstSlash === -1) {
		// No slash means it's the root folder itself, skip it
		return '';
	}
	return zipPath.substring(firstSlash + 1);
}

/**
 * Get file type category for logging/metrics.
 */
export function getFileCategory(
	path: string
): 'text' | 'binary' | 'skipped-dir' | 'unknown' {
	if (shouldSkipDirectory(path)) {
		return 'skipped-dir';
	}

	const ext = getExtension(path);

	if (BINARY_EXTENSIONS.has(ext)) {
		return 'binary';
	}

	if (TEXT_EXTENSIONS.has(ext) || SPECIAL_TEXT_FILES.has(getFilename(path))) {
		return 'text';
	}

	return 'unknown';
}
