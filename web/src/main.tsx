import { startRouter, navigate } from '@doc-platform/router';
import type { RouteProps } from '@doc-platform/router';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchClient } from '@doc-platform/fetch';
import { NotFound } from '@doc-platform/ui';

// Shared feature components
import { Board, EpicDetail } from '@shared/planning';
import { Editor } from '@shared/pages';
import { ProjectsList, type Project } from '@shared/projects';

// App-specific routes
import { UserSettings } from './routes/settings/UserSettings';
import { UIDemo } from './routes/ui-demo/UIDemo';
import { OAuthConsent } from './routes/oauth/OAuthConsent';

// Global styles - common CSS shared with SSG pages, then app-specific
import '../../ssg/src/styles/common.css';
import './styles/tokens.css';
import './styles/global.css';

// Cookie helper
function getCookie(name: string): string | null {
	const cookies = document.cookie ? document.cookie.split('; ') : [];
	for (const cookie of cookies) {
		const [cookieName, ...valueParts] = cookie.split('=');
		if (cookieName === name) {
			const value = valueParts.join('=');
			try {
				return decodeURIComponent(value);
			} catch {
				return value;
			}
		}
	}
	return null;
}

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
					navigate(`/projects/${projects[0].id}/planning`);
				} else if (lastProjectId && isValidUUID(lastProjectId)) {
					// Multiple projects with valid cookie - check if project exists
					const projectExists = projects.some((p) => p.id === lastProjectId);
					if (projectExists) {
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
	{ route: '/ui', entry: UIDemo },
	{ route: '/oauth/consent', entry: OAuthConsent },

	// Smart redirect based on cookie
	{ route: '/', entry: RootRedirect },
];

startRouter(routes, document.getElementById('app')!, NotFound);
