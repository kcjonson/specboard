/**
 * @doc-platform/router
 *
 * Minimal client-side router. Intercepts <a> clicks automatically.
 * View components don't need to know about routing.
 *
 * @example
 * ```tsx
 * import { startRouter } from '@doc-platform/router';
 *
 * const routes = [
 *   { route: '/', entry: HomePage },
 *   { route: '/login', entry: LoginPage },
 *   { route: '/users/:id', entry: UserPage },
 * ];
 *
 * const stop = startRouter(routes, document.getElementById('app')!);
 * // Call stop() to remove event listeners (useful for HMR)
 * ```
 */

import { render, type ComponentType, type JSX } from 'preact';

/**
 * Props passed to route components.
 */
export interface RouteProps {
	params: Record<string, string>;
}

/**
 * Route configuration.
 */
export interface Route {
	route: string;
	entry: ComponentType<RouteProps>;
}

/**
 * Router options.
 */
export interface RouterOptions {
	/** Component to render when no route matches */
	notFound?: ComponentType<Record<string, never>>;
}

/** Current routes */
let currentRoutes: Route[] = [];

/** Current container */
let currentContainer: Element | null = null;

/** Current not found component */
let currentNotFound: ComponentType<Record<string, never>> | null = null;

/** Default not found component */
function DefaultNotFound(): JSX.Element {
	return <div>Not Found</div>;
}

/**
 * Match a pathname against routes.
 * Returns matched route and extracted params.
 */
function matchRoute(pathname: string): { route: Route; params: Record<string, string> } | null {
	const path = pathname === '/' ? '/' : pathname.replace(/\/$/, '');

	for (const route of currentRoutes) {
		const pattern = route.route === '/' ? '/' : route.route.replace(/\/$/, '');
		const patternParts = pattern.split('/').filter(Boolean);
		const pathParts = path.split('/').filter(Boolean);

		if (patternParts.length !== pathParts.length) continue;

		const params: Record<string, string> = {};
		let matched = true;

		for (let i = 0; i < patternParts.length; i++) {
			const patternPart = patternParts[i] as string;
			const pathPart = pathParts[i] as string;

			if (patternPart.startsWith(':')) {
				const paramName = patternPart.slice(1);
				try {
					params[paramName] = decodeURIComponent(pathPart);
				} catch {
					// Fall back to raw value if decoding fails
					params[paramName] = pathPart;
				}
			} else if (patternPart !== pathPart) {
				matched = false;
				break;
			}
		}

		if (matched) {
			return { route, params };
		}
	}

	return null;
}

/**
 * Render the current route.
 */
function renderCurrentRoute(): void {
	if (!currentContainer) return;

	const match = matchRoute(window.location.pathname);

	if (match) {
		const Component = match.route.entry;
		render(<Component params={match.params} />, currentContainer);
	} else {
		const NotFoundComponent = currentNotFound || DefaultNotFound;
		render(<NotFoundComponent />, currentContainer);
	}
}

/**
 * Get current URL (pathname + search + hash).
 */
function getCurrentUrl(): string {
	return window.location.pathname + window.location.search + window.location.hash;
}

/**
 * Navigate to a path programmatically.
 * Supports query strings and hash fragments.
 *
 * @example
 * ```ts
 * navigate('/dashboard');
 * navigate('/search?q=test');
 * navigate('/docs#section');
 * ```
 */
export function navigate(path: string): void {
	if (path !== getCurrentUrl()) {
		window.history.pushState(null, '', path);
		renderCurrentRoute();
	}
}

/**
 * Start the router.
 * Intercepts <a> clicks and handles browser navigation.
 * Returns a cleanup function to remove event listeners.
 *
 * @example
 * ```tsx
 * const stop = startRouter(routes, document.getElementById('app')!, {
 *   notFound: NotFoundComponent,
 * });
 * // Call stop() to cleanup (useful for HMR or tests)
 * ```
 */
export function startRouter(routes: Route[], container: Element, options?: RouterOptions): () => void {
	currentRoutes = routes;
	currentContainer = container;
	currentNotFound = options?.notFound || null;

	// Handle browser back/forward
	const handlePopState = (): void => {
		renderCurrentRoute();
	};
	window.addEventListener('popstate', handlePopState);

	// Intercept <a> clicks
	const handleClick = (e: MouseEvent): void => {
		// Only handle left clicks
		if (e.button !== 0) return;

		const target = e.target as Element;
		const anchor = target.closest('a');

		if (!anchor) return;

		const href = anchor.getAttribute('href');
		if (!href) return;

		// Skip external links, hash-only links, and modified clicks
		if (
			href.startsWith('http') ||
			href.startsWith('//') ||
			href.startsWith('#') ||
			anchor.hasAttribute('download') ||
			anchor.getAttribute('target') === '_blank' ||
			e.metaKey ||
			e.ctrlKey ||
			e.shiftKey ||
			e.altKey
		) {
			return;
		}

		e.preventDefault();
		navigate(href);
	};
	document.addEventListener('click', handleClick);

	// Initial render
	renderCurrentRoute();

	// Return cleanup function
	return () => {
		window.removeEventListener('popstate', handlePopState);
		document.removeEventListener('click', handleClick);
	};
}
