import { startRouter, navigate } from '@doc-platform/router';
import type { RouteProps } from '@doc-platform/router';

// Shared feature components
import { Board, EpicDetail } from '@shared/planning';
import { Editor } from '@shared/pages';

// App-specific routes
import { UserSettings } from './routes/settings/UserSettings';
import { UIDemo } from './routes/ui-demo/UIDemo';

// Global styles - shared UI styles first, then app-specific
import '@doc-platform/ui/shared.css';
import './styles/tokens.css';
import './styles/global.css';

// Stub project ID until we have real project management
const DEFAULT_PROJECT_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

// Redirect component for root path
function RootRedirect(_props: RouteProps): null {
	// Redirect to default project's planning board
	navigate(`/projects/${DEFAULT_PROJECT_ID}/planning`);
	return null;
}

const routes = [
	// Project-scoped routes
	{ route: '/projects/:projectId/planning', entry: Board },
	{ route: '/projects/:projectId/planning/epics/:id', entry: EpicDetail },
	{ route: '/projects/:projectId/pages', entry: Editor },

	// App routes (not project-scoped)
	{ route: '/settings', entry: UserSettings },
	{ route: '/ui', entry: UIDemo },

	// Default redirect to planning
	{ route: '/', entry: RootRedirect },
];

startRouter(routes, document.getElementById('app')!);
