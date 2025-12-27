import * as Sentry from '@sentry/browser';
import { startRouter } from '@doc-platform/router';
import { fetchClient } from '@doc-platform/fetch';
import { Board } from './routes/board/Board';
import { EpicDetail } from './routes/epic/EpicDetail';
import { UserSettings } from './routes/settings/UserSettings';
import { UIDemo } from './routes/ui-demo/UIDemo';

// Global styles - shared UI tokens first, then planning-specific tokens
import '@doc-platform/ui/tokens.css';
import './styles/tokens.css';
import './styles/global.css';

// Initialize Sentry error tracking (tunneled through our API)
if (import.meta.env.VITE_SENTRY_DSN) {
	Sentry.init({
		dsn: import.meta.env.VITE_SENTRY_DSN,
		tunnel: '/api/metrics',
		environment: import.meta.env.MODE,
	});
}

// Configure API base URL
fetchClient.setBaseURL('http://localhost:3001');

const routes = [
	{ route: '/', entry: Board },
	{ route: '/epics/:id', entry: EpicDetail },
	{ route: '/settings', entry: UserSettings },
	{ route: '/ui', entry: UIDemo },
];

startRouter(routes, document.getElementById('app')!);
