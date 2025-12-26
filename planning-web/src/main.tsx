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

// Configure API base URL
fetchClient.setBaseURL('http://localhost:3001');

const routes = [
	{ route: '/', entry: Board },
	{ route: '/epics/:id', entry: EpicDetail },
	{ route: '/settings', entry: UserSettings },
	{ route: '/ui', entry: UIDemo },
];

startRouter(routes, document.getElementById('app')!);
