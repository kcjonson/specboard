import { handleLayoutRequest, type MapLayoutRequest, type MapLayoutResponse } from './protocol';

// Typed locally rather than through the webworker lib, which can't share a program
// with the DOM lib the rest of the app compiles against.
interface LayoutWorkerScope {
	onmessage: ((event: { data: MapLayoutRequest }) => void) | null;
	postMessage(message: MapLayoutResponse): void;
}

const scope = globalThis as unknown as LayoutWorkerScope;

scope.onmessage = (event) => scope.postMessage(handleLayoutRequest(event.data, () => globalThis.performance.now()));
