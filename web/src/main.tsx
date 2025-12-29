import { startRouter, navigate } from '@doc-platform/router';
import type { RouteProps } from '@doc-platform/router';

// Shared feature components
import { Board, EpicDetail } from '@shared/planning';
import { Editor } from '@shared/pages';
import { ProjectsList } from '@shared/projects';

// App-specific routes
import { UserSettings } from './routes/settings/UserSettings';
import { UIDemo } from './routes/ui-demo/UIDemo';

// Global styles - shared UI styles first, then app-specific
import '@doc-platform/ui/shared.css';
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

// Smart redirect component for root path
function RootRedirect(_props: RouteProps): null {
	// Check for last project cookie
	const lastProjectId = getCookie('lastProjectId');

	if (lastProjectId) {
		// User has a recent project - go there
		navigate(`/projects/${lastProjectId}/planning`);
	} else {
		// No recent project - show projects list
		navigate('/projects');
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

	// Smart redirect based on cookie
	{ route: '/', entry: RootRedirect },
];

startRouter(routes, document.getElementById('app')!);
