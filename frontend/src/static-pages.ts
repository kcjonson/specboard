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

const isDev = !!process.env.VITE_DEV_SERVER;

/**
 * Rewrite production CSS paths to Vite-servable dev paths.
 * Production: /assets/styles/common-HASH.css, /assets/styles/ssg/login-HASH.css
 * Dev: /@fs/app/shared/styles/common.css, /@fs/app/ssg/src/styles/login.css
 */
function rewriteCssPathsForDev(html: string): string {
	return html
		// Shared: /assets/styles/common-HASH.css → /@fs/app/shared/styles/common.css
		.replace(
			/\/assets\/styles\/common-[A-Za-z0-9_-]{8}\.css/g,
			'/@fs/app/shared/styles/common.css'
		)
		// SSG: /assets/styles/ssg/NAME-HASH.css → /@fs/app/ssg/src/styles/NAME.css
		.replace(
			/\/assets\/styles\/ssg\/([a-z-]+)-[A-Za-z0-9_-]{8}\.css/g,
			'/@fs/app/ssg/src/styles/$1.css'
		);
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

// In dev, SSG dist is at ./ssg/dist; in prod it's copied to ./static/ssg
const ssgBase = isDev ? './ssg/dist' : './static/ssg';
const spaBase = isDev ? './web/dist' : './static';

/**
 * Load a page into memory with precomputed headers
 */
function loadPage(path: string): CachedPage {
	try {
		let html = readFileSync(path, 'utf-8');

		// In dev mode, rewrite CSS paths to Vite-servable paths
		if (isDev) {
			html = rewriteCssPathsForDev(html);
		}

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
	login: loadPage(`${ssgBase}/login.html`),
	signup: loadPage(`${ssgBase}/signup.html`),
	home: loadPage(`${ssgBase}/home.html`),
	notFound: loadPage(`${ssgBase}/not-found.html`),
	verifyEmail: loadPage(`${ssgBase}/verify-email.html`),
	verifyEmailConfirm: loadPage(`${ssgBase}/verify-email/confirm.html`),
	forgotPassword: loadPage(`${ssgBase}/forgot-password.html`),
	resetPassword: loadPage(`${ssgBase}/reset-password.html`),
};

/**
 * SPA index.html cached at startup
 */
export const spaIndex = loadPage(`${spaBase}/index.html`);
