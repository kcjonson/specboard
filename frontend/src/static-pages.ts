/**
 * Static page cache for SSG pages
 *
 * Loads all SSG pages into memory at startup for zero disk reads per request.
 * Precomputes Link preload headers for CSS files.
 */

import { readFileSync } from 'node:fs';

export interface CachedPage {
	html: string;
	preloadHeader: string;
}

/**
 * Extract CSS paths from HTML and build Link preload header
 */
function buildPreloadHeader(html: string): string {
	const cssRegex = /<link rel="stylesheet" href="([^"]+)">/g;
	const cssFiles: string[] = [];
	let match;
	while ((match = cssRegex.exec(html)) !== null) {
		if (match[1]) {
			cssFiles.push(match[1]);
		}
	}
	return cssFiles
		.map(href => `<${href}>; rel=preload; as=style`)
		.join(', ');
}

/**
 * Load a page into memory with precomputed headers
 */
function loadPage(path: string): CachedPage {
	const html = readFileSync(path, 'utf-8');
	return {
		html,
		preloadHeader: buildPreloadHeader(html),
	};
}

/**
 * All SSG pages loaded at startup
 */
export const pages = {
	login: loadPage('./static/ssg/login.html'),
	signup: loadPage('./static/ssg/signup.html'),
	home: loadPage('./static/ssg/home.html'),
	notFound: loadPage('./static/ssg/not-found.html'),
};

/**
 * SPA index.html cached at startup
 */
export const spaIndex = loadPage('./static/index.html');
