import { startRouter } from '@doc-platform/router';

// Shared feature components
import { Board, EpicDetail } from '@shared/planning';
import { Editor } from '@shared/pages';

// App-specific routes
import { UserSettings } from './routes/settings/UserSettings';
import { UIDemo } from './routes/ui-demo/UIDemo';

// Global styles - shared UI tokens first, then app-specific tokens
import '@doc-platform/ui/tokens.css';
import './styles/tokens.css';
import './styles/global.css';

const routes = [
	// Planning routes
	{ route: '/planning', entry: Board },
	{ route: '/planning/epics/:id', entry: EpicDetail },

	// Pages routes
	{ route: '/pages', entry: Editor },

	// App routes
	{ route: '/settings', entry: UserSettings },
	{ route: '/ui', entry: UIDemo },

	// Default redirect to planning
	{ route: '/', entry: Board },
];

startRouter(routes, document.getElementById('app')!);
