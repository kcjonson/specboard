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
	for (const match of html.matchAll(cssRegex)) {
		const href = match[1];
		if (href) {
			cssFiles.push(href);
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
	try {
		const html = readFileSync(path, 'utf-8');
		return {
			html,
			preloadHeader: buildPreloadHeader(html),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(
			`Failed to load static page "${path}". ` +
			`Ensure the SSG build has been run (pnpm --filter @doc-platform/ssg build). ` +
			`Error: ${message}`,
		);
		throw error;
	}
}

/**
 * All SSG pages loaded at startup
 */
export const pages = {
	login: loadPage('./static/ssg/login.html'),
	signup: loadPage('./static/ssg/signup.html'),
	home: loadPage('./static/ssg/home.html'),
	notFound: loadPage('./static/ssg/not-found.html'),
	verifyEmail: loadPage('./static/ssg/verify-email.html'),
	verifyEmailConfirm: loadPage('./static/ssg/verify-email/confirm.html'),
	forgotPassword: loadPage('./static/ssg/forgot-password.html'),
	resetPassword: loadPage('./static/ssg/reset-password.html'),
};

/**
 * SPA index.html cached at startup
 */
export const spaIndex = loadPage('./static/index.html');
