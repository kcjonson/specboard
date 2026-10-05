import { handleRequest, transferablesOf, type MapLayoutRequest, type MapLayoutResponse, type MapOutlineRequest, type MapOutlineResponse } from './protocol';

// Typed locally rather than through the webworker lib, which can't share a program
// with the DOM lib the rest of the app compiles against.
interface LayoutWorkerScope {
	onmessage: ((event: { data: MapLayoutRequest | MapOutlineRequest }) => void) | null;
	postMessage(message: MapLayoutResponse | MapOutlineResponse, transfer: ArrayBuffer[]): void;
}

const scope = globalThis as unknown as LayoutWorkerScope;

scope.onmessage = (event) => {
	const response = handleRequest(event.data, () => globalThis.performance.now());
	scope.postMessage(response, transferablesOf(response));
};
