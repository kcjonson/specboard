import { startRouter } from '@doc-platform/router';
import { Board } from './pages/Board';
import { EpicDetail } from './pages/EpicDetail';

// Global styles
import './styles/tokens.css';
import './styles/global.css';

const routes = [
	{ route: '/', entry: Board },
	{ route: '/epics/:id', entry: EpicDetail },
];

startRouter(routes, document.getElementById('app')!);
