import { startRouter, navigate } from '@doc-platform/router';
import type { RouteProps } from '@doc-platform/router';
import { NotFound } from '@doc-platform/ui';

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

// UUID validation for cookie values
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(id: string): boolean {
	return UUID_REGEX.test(id);
}

// Smart redirect component for root path
function RootRedirect(_props: RouteProps): null {
	// Check for last project cookie
	const lastProjectId = getCookie('lastProjectId');

	if (lastProjectId && isValidUUID(lastProjectId)) {
		// User has a valid recent project - go there
		navigate(`/projects/${lastProjectId}/planning`);
	} else {
		// No recent project or invalid cookie - show projects list
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

startRouter(routes, document.getElementById('app')!, { notFound: NotFound });
