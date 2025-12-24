import { startRouter } from '@doc-platform/router';
import { fetchClient } from '@doc-platform/fetch';
import { Board } from './routes/board/Board';
import { EpicDetail } from './routes/epic/EpicDetail';

// Global styles
import './styles/tokens.css';
import './styles/global.css';

// Configure API base URL
fetchClient.setBaseURL('http://localhost:3001');

const routes = [
	{ route: '/', entry: Board },
	{ route: '/epics/:id', entry: EpicDetail },
];

startRouter(routes, document.getElementById('app')!);
