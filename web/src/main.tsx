import { init as initTelemetry } from '@doc-platform/telemetry';
import { startRouter, navigate } from '@doc-platform/router';
import type { RouteProps } from '@doc-platform/router';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { getCookie, setCookie } from '@doc-platform/core/cookies';
import { fetchClient } from '@doc-platform/fetch';
import { NotFound } from '@doc-platform/ui';

// Initialize error reporting
initTelemetry({
	enabled: import.meta.env.WEB_ERROR_REPORTING_ENABLED === 'true',
	environment: import.meta.env.MODE,
});

// Shared feature components
import { Board, EpicDetail } from '@shared/planning';
import { Editor } from '@doc-platform/pages';
import { ProjectsList, type Project } from '@shared/projects';

// App-specific routes
import { UserSettings } from './routes/settings/UserSettings';
import { UIDemo } from './routes/ui-demo/UIDemo';
import { OAuthConsent } from './routes/oauth/OAuthConsent';
import { Admin } from './routes/admin/Admin';
import { AdminUsers } from './routes/admin/AdminUsers';

// Global styles - common CSS shared with SSG pages, then app-specific
import '../../shared/styles/common.css';
import './styles/tokens.css';
import './styles/global.css';

// UUID validation for cookie values
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(id: string): boolean {
	return UUID_REGEX.test(id);
}

// Smart redirect component for root path
// Fetches projects and redirects based on:
// - 0 projects → /projects
// - 1 project → /projects/:id/planning
// - Multiple projects + valid cookie → /projects/:id/planning
// - Multiple projects + no cookie → /projects
function RootRedirect(_props: RouteProps): JSX.Element | null {
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function determineRedirect(): Promise<void> {
			try {
				const projects = await fetchClient.get<Project[]>('/api/projects');
				const lastProjectId = getCookie('lastProjectId');

				if (projects.length === 0) {
					// No projects - go to projects list
					navigate('/projects');
				} else if (projects.length === 1) {
					// Single project - go directly there
					const [project] = projects;
					if (project) {
						setCookie('lastProjectId', project.id, 30);
						setCookie('lastProjectName', project.name, 30);
						navigate(`/projects/${project.id}/planning`);
					}
				} else if (lastProjectId && isValidUUID(lastProjectId)) {
					// Multiple projects with valid cookie - check if project exists
					const project = projects.find((p) => p.id === lastProjectId);
					if (project) {
						// Refresh both cookies together to keep them in sync
						setCookie('lastProjectId', project.id, 30);
						setCookie('lastProjectName', project.name, 30);
						navigate(`/projects/${lastProjectId}/planning`);
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

	// Project-scoped routes
	{ route: '/projects/:projectId/planning', entry: Board },
	{ route: '/projects/:projectId/planning/epics/:id', entry: EpicDetail },
	{ route: '/projects/:projectId/pages', entry: Editor },

	// App routes (not project-scoped)
	{ route: '/settings', entry: UserSettings },
	{ route: '/oauth/consent', entry: OAuthConsent },

	// Admin routes
	{ route: '/admin', entry: Admin },
	{ route: '/admin/users', entry: AdminUsers },
	{ route: '/admin/users/:userId', entry: UserSettings },
	{ route: '/admin/ui', entry: UIDemo },

	// Smart redirect based on cookie
	{ route: '/', entry: RootRedirect },
];

startRouter(routes, document.getElementById('app')!, NotFound);
