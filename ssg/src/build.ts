/**
 * SSG Build Script
 *
 * Renders Preact components to static HTML files.
 * Reads CSS paths from Vite manifest for cache-busted URLs.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'preact-render-to-string';

import { renderDocument } from './shell.js';
import { LoginContent, loginScript } from './pages/login.js';
import { SignupContent, signupScript } from './pages/signup.js';
import { NotFoundContent } from './pages/not-found.js';
import { HomeContent } from './pages/home.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Manifest entry from Vite build
interface ManifestEntry {
	file: string;
	css?: string[];
	src?: string;
}

type Manifest = Record<string, ManifestEntry>;

/**
 * Read Vite manifest and extract CSS paths
 */
function loadManifest(): Manifest {
	const manifestPath = resolve(__dirname, '../../web/dist/.vite/manifest.json');
	try {
		return JSON.parse(readFileSync(manifestPath, 'utf-8'));
	} catch {
		console.error('Failed to read Vite manifest:', manifestPath);
		console.error('Make sure to run `pnpm --filter web build` first');
		throw new Error('Manifest not found');
	}
}

/**
 * Get the hashed CSS path for a given entry
 */
function getCssPath(manifest: Manifest, entry: string): string {
	const manifestEntry = manifest[entry];
	if (!manifestEntry?.file) {
		throw new Error(`Missing manifest entry for: ${entry}`);
	}
	return '/' + manifestEntry.file;
}

/**
 * Write HTML file to output directory
 */
function writePage(filename: string, html: string): void {
	const outDir = resolve(__dirname, '../dist');
	const outPath = resolve(outDir, filename);

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, html);
	console.log(`  ${filename}`);
}

/**
 * Build all SSG pages
 */
function build(): void {
	console.log('Building SSG pages...\n');

	const manifest = loadManifest();

	// Get CSS paths from manifest
	// NOTE: Manifest keys use '../ssg/src/styles/' prefix because Vite generates
	// keys relative to the web directory where the build runs. These keys must
	// match the paths defined in web/vite.config.ts rollupOptions.input.
	const commonCss = getCssPath(manifest, '../ssg/src/styles/common.css');
	const loginCss = getCssPath(manifest, '../ssg/src/styles/login.css');
	const signupCss = getCssPath(manifest, '../ssg/src/styles/signup.css');
	const notFoundCss = getCssPath(manifest, '../ssg/src/styles/not-found.css');
	const homeCss = getCssPath(manifest, '../ssg/src/styles/home.css');

	// Render login page
	writePage('login.html', renderDocument({
		title: 'Sign In - Doc Platform',
		cssFiles: [commonCss, loginCss],
		body: render(LoginContent()),
		scripts: loginScript,
	}));

	// Render signup page
	writePage('signup.html', renderDocument({
		title: 'Create Account - Doc Platform',
		cssFiles: [commonCss, signupCss],
		body: render(SignupContent()),
		scripts: signupScript,
	}));

	// Render not found page
	writePage('not-found.html', renderDocument({
		title: 'Page Not Found - Doc Platform',
		cssFiles: [commonCss, notFoundCss],
		body: render(NotFoundContent()),
	}));

	// Render home page
	writePage('home.html', renderDocument({
		title: 'Doc Platform - Documentation that works for your team',
		description: 'A Git-backed markdown editor with real-time collaboration, inline comments, and AI-powered assistance.',
		cssFiles: [commonCss, homeCss],
		body: render(HomeContent()),
	}));

	console.log('\nSSG build complete!');
}

build();
