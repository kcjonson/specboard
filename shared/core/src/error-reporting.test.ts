import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { parseStackTrace } from './error-reporting.ts';

describe('handleFatalError', () => {
	let exitSpy: MockInstance;
	let errorSpy: MockInstance;

	beforeEach(() => {
		// Fresh module per test so the re-entrancy flag resets
		vi.resetModules();
		exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubEnv('ERROR_REPORTING_DSN', '');
		vi.stubEnv('ERROR_LOG_GROUP', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('logs the error and exits with code 1', async () => {
		const { handleFatalError } = await import('./error-reporting.ts');
		handleFatalError(new Error('boom'), 'api', 'uncaught_exception');
		await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
		expect(errorSpy).toHaveBeenCalledWith(
			'Uncaught exception:',
			expect.objectContaining({ message: 'boom' })
		);
	});

	it('wraps non-Error rejection reasons', async () => {
		const { handleFatalError } = await import('./error-reporting.ts');
		handleFatalError('string reason', 'api', 'unhandled_rejection');
		await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
		expect(errorSpy).toHaveBeenCalledWith(
			'Unhandled rejection:',
			expect.objectContaining({ message: 'string reason' })
		);
	});

	it('does not schedule a second exit while already handling a fatal error', async () => {
		const { handleFatalError } = await import('./error-reporting.ts');
		handleFatalError(new Error('first'), 'api', 'uncaught_exception');
		handleFatalError(new Error('second'), 'api', 'uncaught_exception');
		await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
		expect(exitSpy).toHaveBeenCalledTimes(1);
	});

	it('exits after the flush timeout when the report never completes', async () => {
		vi.useFakeTimers();
		vi.stubEnv('ERROR_REPORTING_DSN', 'https://key@errors.example.com/1');
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
		const { handleFatalError } = await import('./error-reporting.ts');
		handleFatalError(new Error('boom'), 'api', 'uncaught_exception');
		expect(exitSpy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(3000);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('installErrorHandlers wires both fatal events to handleFatalError', async () => {
		const { installErrorHandlers } = await import('./error-reporting.ts');
		const priorUncaught = process.listeners('uncaughtException');
		const priorRejection = process.listeners('unhandledRejection');
		installErrorHandlers('api');
		const uncaught = process
			.listeners('uncaughtException')
			.filter((listener) => !priorUncaught.includes(listener));
		const rejection = process
			.listeners('unhandledRejection')
			.filter((listener) => !priorRejection.includes(listener));
		try {
			expect(uncaught).toHaveLength(1);
			expect(rejection).toHaveLength(1);
			uncaught[0]?.(new Error('boom'), 'uncaughtException');
			await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
		} finally {
			for (const listener of uncaught) {
				process.removeListener('uncaughtException', listener);
			}
			for (const listener of rejection) {
				process.removeListener('unhandledRejection', listener);
			}
		}
	});
});

describe('parseStackTrace', () => {
	it('returns no frames for an absent stack', () => {
		expect(parseStackTrace(undefined)).toEqual([]);
	});

	it('parses a Chrome/Node frame with a function name', () => {
		const frames = parseStackTrace('Error: boom\n    at loadTree (/app/src/tree.ts:42:15)');
		expect(frames).toEqual([
			{ function: 'loadTree', filename: '/app/src/tree.ts', lineno: 42, colno: 15 },
		]);
	});

	it('parses a bare Chrome/Node frame as anonymous', () => {
		const frames = parseStackTrace('    at /app/src/tree.ts:42:15');
		expect(frames).toEqual([
			{ function: '<anonymous>', filename: '/app/src/tree.ts', lineno: 42, colno: 15 },
		]);
	});

	it('parses a frame with no line or column', () => {
		const frames = parseStackTrace('    at loadTree (native)');
		expect(frames).toEqual([
			{ function: 'loadTree', filename: 'native', lineno: undefined, colno: undefined },
		]);
	});

	it('keeps bracketed method names intact', () => {
		const frames = parseStackTrace('    at Object.run [as handler] (/app/x.ts:3:9)');
		expect(frames[0]?.function).toBe('Object.run [as handler]');
		expect(frames[0]?.filename).toBe('/app/x.ts');
	});

	it('parses the Firefox format', () => {
		const frames = parseStackTrace('loadTree@/app/src/tree.ts:42:15');
		expect(frames).toEqual([
			{ function: 'loadTree', filename: '/app/src/tree.ts', lineno: 42, colno: 15 },
		]);
	});

	it('returns innermost frame first', () => {
		const frames = parseStackTrace('Error: boom\n    at outer (/a.ts:1:1)\n    at inner (/b.ts:2:2)');
		expect(frames.map((f) => f.filename)).toEqual(['/b.ts', '/a.ts']);
	});

	it('stays fast on a frame line padded around an open paren', () => {
		// Guards the ReDoS fix. The lone '(' is what makes the old regex's first lazy
		// group participate and then fail, so it retried every split point: measured at
		// this size the old pattern took ~2.6s, the new parser under a millisecond.
		const pad = ' '.repeat(40_000);
		const start = Date.now();
		const frames = parseStackTrace(`    at ${pad}(${pad}`);
		expect(frames[0]?.function).toBe('<anonymous>');
		expect(Date.now() - start).toBeLessThan(1000);
	});
});
