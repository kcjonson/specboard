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
import { HomeContent, homeScript } from './pages/home.js';
import { VerifyEmailContent, verifyEmailScript } from './pages/verify-email.js';
import { VerifyEmailConfirmContent, verifyEmailConfirmScript } from './pages/verify-email-confirm.js';
import { ForgotPasswordContent, forgotPasswordScript } from './pages/forgot-password.js';
import { ResetPasswordContent, resetPasswordScript } from './pages/reset-password.js';

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
		console.error('Make sure to run `npm run --workspace web build` first');
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
	// Keys match the rollupOptions.input keys in web/vite.config.ts
	const commonCss = getCssPath(manifest, '../shared/styles/common.css');
	const loginCss = getCssPath(manifest, '../ssg/src/styles/login.css');
	const signupCss = getCssPath(manifest, '../ssg/src/styles/signup.css');
	const notFoundCss = getCssPath(manifest, '../ssg/src/styles/not-found.css');
	const homeCss = getCssPath(manifest, '../ssg/src/styles/home.css');
	const authCss = getCssPath(manifest, '../ssg/src/styles/auth.css');

	// Render login page
	writePage('login.html', renderDocument({
		title: 'Sign In - Specboard',
		cssFiles: [commonCss, loginCss],
		body: render(LoginContent()),
		scripts: loginScript,
	}));

	// Render signup page
	writePage('signup.html', renderDocument({
		title: 'Create Account - Specboard',
		cssFiles: [commonCss, signupCss],
		body: render(SignupContent()),
		scripts: signupScript,
	}));

	// Render not found page
	writePage('not-found.html', renderDocument({
		title: 'Page Not Found - Specboard',
		cssFiles: [commonCss, notFoundCss],
		body: render(NotFoundContent()),
	}));

	// Render home page
	writePage('home.html', renderDocument({
		title: 'Specboard - Workflow tools for AI assisted product development',
		description: 'Specs, planning, and context management for developers working with AI coding agents. Give your AI the structure it needs to ship quality code.',
		cssFiles: [commonCss, homeCss],
		body: render(HomeContent()),
		scripts: homeScript,
	}));

	// Render verify email page (shown after signup)
	writePage('verify-email.html', renderDocument({
		title: 'Verify Your Email - Specboard',
		cssFiles: [commonCss, authCss],
		body: render(VerifyEmailContent()),
		scripts: verifyEmailScript,
	}));

	// Render verify email confirmation page (processes token from email link)
	writePage('verify-email/confirm.html', renderDocument({
		title: 'Verifying Email - Specboard',
		cssFiles: [commonCss, authCss],
		body: render(VerifyEmailConfirmContent()),
		scripts: verifyEmailConfirmScript,
	}));

	// Render forgot password page
	writePage('forgot-password.html', renderDocument({
		title: 'Reset Password - Specboard',
		cssFiles: [commonCss, authCss],
		body: render(ForgotPasswordContent()),
		scripts: forgotPasswordScript,
	}));

	// Render reset password page (processes token from email link)
	writePage('reset-password.html', renderDocument({
		title: 'Set New Password - Specboard',
		cssFiles: [commonCss, authCss],
		body: render(ResetPasswordContent()),
		scripts: resetPasswordScript,
	}));

	console.log('\nSSG build complete!');
}

build();
