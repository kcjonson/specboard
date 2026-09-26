import { init as initTelemetry } from '@specboard/telemetry';
import { startRouter, navigate } from '@specboard/router';
import type { RouteProps } from '@specboard/router';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { getCookie, setCookie } from '@specboard/core/cookies';
import { formatProjectRef, parseProjectRef } from '@specboard/core/identifiers';
import { fetchClient } from '@specboard/fetch';
import { NotFound } from '@specboard/ui';

// Initialize error reporting
initTelemetry({
	enabled: import.meta.env.WEB_ERROR_REPORTING_ENABLED === 'true',
	environment: import.meta.env.MODE,
});

// Shared feature components
import { Planning, ItemDetail } from '@shared/planning';
import { Editor } from '@specboard/pages';
import { ProjectsList, type Project } from '@shared/projects';

// App-specific routes
import { Onboarding } from './routes/onboarding/Onboarding';
import { UserSettings } from './routes/settings/UserSettings';
import { UIDemo } from './routes/ui-demo/UIDemo';
import { OAuthConsent } from './routes/oauth/OAuthConsent';
import { Admin } from './routes/admin/Admin';
import { AdminUsers } from './routes/admin/AdminUsers';
import { AdminWaitlist } from './routes/admin/AdminWaitlist';
import { adminOnly } from './routes/admin/admin-only';

// Global styles - common CSS shared with SSG pages, then app-specific
import '../../shared/styles/common.css';
import './styles/tokens.css';
import './styles/global.css';

// Smart redirect component for root path
// Fetches projects and redirects based on:
// - 0 projects → /projects
// - 1 project → /projects/:owner/:project/planning
// - Multiple projects + valid cookie → /projects/:owner/:project/planning
// - Multiple projects + no cookie → /projects
function RootRedirect(_props: RouteProps): JSX.Element | null {
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		function open(project: Project): void {
			const projectRef = formatProjectRef(project.ownerSlug, project.slug);
			// Refresh both cookies together to keep them in sync
			setCookie('lastProjectRef', projectRef, 30);
			setCookie('lastProjectName', project.name, 30);
			navigate(`/projects/${projectRef}/planning`);
		}

		async function determineRedirect(): Promise<void> {
			try {
				const projects = await fetchClient.get<Project[]>('/api/projects');
				// A bare slug from before owner-namespaced URLs doesn't parse as a full ref.
				const lastRef = parseProjectRef(getCookie('lastProjectRef'));

				if (projects.length === 0) {
					navigate('/projects');
				} else if (projects.length === 1) {
					open(projects[0]!);
				} else if (lastRef?.owner) {
					// Multiple projects with valid cookie - check if project exists
					const project = projects.find((p) => p.ownerSlug === lastRef.owner && p.slug === lastRef.project);
					if (project) {
						open(project);
					} else {
						// Cookie references deleted project - go to list
						navigate('/projects');
					}
				} else {
					// Multiple projects, no cookie - go to list
					navigate('/projects');
				}
			} catch {
				// API error - fall back to projects list
				navigate('/projects');
			} finally {
				setLoading(false);
			}
		}

		determineRedirect();
	}, []);

	if (loading) {
		return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;
	}

	return null;
}

const routes = [
	// Projects list (first thing user sees if no recent project)
	{ route: '/projects', entry: ProjectsList },

	// Project-scoped routes. The board and the board-with-an-item-selected share the
	// Planning entry, so selecting a card is a navigation (working Back) rather than
	// hidden state; ItemDetail is the standalone full-page view, and a document load
	// of the drawer URL is redirected there by the frontend service.
	{ route: '/projects/:owner/:project/planning', entry: Planning },
	{ route: '/projects/:owner/:project/planning/items/:itemKey', entry: Planning },
	{ route: '/projects/:owner/:project/items/:itemKey', entry: ItemDetail },
	{ route: '/projects/:owner/:project/pages', entry: Editor },

	// App routes (not project-scoped)
	// Onboarding gating is server-side: the frontend service redirects SPA
	// document loads here while the session's profileComplete flag is false
	{ route: '/onboarding', entry: Onboarding },
	{ route: '/settings', entry: UserSettings },
	{ route: '/oauth/consent', entry: OAuthConsent },

	// Admin routes. The frontend service 404s document loads under /admin for
	// non-admins; adminOnly does the same for in-app navigation.
	...[
		{ route: '/admin', entry: Admin },
		{ route: '/admin/users', entry: AdminUsers },
		{ route: '/admin/users/:userId', entry: UserSettings },
		{ route: '/admin/waitlist', entry: AdminWaitlist },
		{ route: '/admin/ui', entry: UIDemo },
	].map(({ route, entry }) => ({ route, entry: adminOnly(entry) })),

	// Smart redirect based on cookie
	{ route: '/', entry: RootRedirect },
];

startRouter(routes, document.getElementById('app')!, NotFound);
