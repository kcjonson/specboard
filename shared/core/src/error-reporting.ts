/**
 * Server-side error reporting utility
 *
 * Builds envelope format and forwards to error tracking service.
 * Used by API, MCP, and the /api/metrics tunnel endpoint.
 */

import { randomUUID } from 'node:crypto';
import {
	CloudWatchLogsClient,
	PutLogEventsCommand,
	CreateLogStreamCommand,
	ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs';

export interface ErrorReport {
	name: string;
	message: string;
	stack?: string;
	timestamp: number;
	url?: string;
	userAgent?: string;
	userId?: string;
	source: 'web' | 'api' | 'mcp' | 'frontend';
	environment?: string;
	extra?: Record<string, unknown>;
}

// Lazy-initialized CloudWatch client
let cloudWatchClient: CloudWatchLogsClient | null = null;
let logStreamName: string | null = null;
let logStreamDate: string | null = null;

function getCloudWatchClient(): CloudWatchLogsClient {
	if (!cloudWatchClient) {
		cloudWatchClient = new CloudWatchLogsClient({});
	}
	return cloudWatchClient;
}

function getLogStreamName(): string {
	const currentDate = new Date().toISOString().split('T')[0] ?? '';

	// Rotate log stream if date has changed (handles long-running processes)
	if (!logStreamName || logStreamDate !== currentDate) {
		logStreamDate = currentDate;
		logStreamName = `${currentDate}-${randomUUID().slice(0, 8)}`;
	}
	return logStreamName;
}

/**
 * Write error to dedicated CloudWatch log group (1 year retention)
 */
async function writeToErrorLogGroup(report: ErrorReport): Promise<void> {
	const logGroupName = process.env.ERROR_LOG_GROUP;
	if (!logGroupName) {
		return;
	}

	const client = getCloudWatchClient();
	const streamName = getLogStreamName();

	const logEvent = {
		type: 'error_report',
		level: 'error',
		timestamp: new Date(report.timestamp).toISOString(),
		source: report.source,
		error: {
			name: report.name,
			message: report.message,
			stack: report.stack,
		},
		userId: report.userId,
		url: report.url,
		userAgent: report.userAgent,
		environment: report.environment,
		extra: report.extra,
	};

	try {
		await client.send(new PutLogEventsCommand({
			logGroupName,
			logStreamName: streamName,
			logEvents: [{
				timestamp: report.timestamp,
				message: JSON.stringify(logEvent),
			}],
		}));
	} catch (error) {
		// If stream doesn't exist, create it and retry
		if (error instanceof ResourceNotFoundException) {
			try {
				await client.send(new CreateLogStreamCommand({
					logGroupName,
					logStreamName: streamName,
				}));
				await client.send(new PutLogEventsCommand({
					logGroupName,
					logStreamName: streamName,
					logEvents: [{
						timestamp: report.timestamp,
						message: JSON.stringify(logEvent),
					}],
				}));
			} catch (retryError) {
				console.error('Failed to write to error log group:', retryError);
			}
		} else {
			console.error('Failed to write to error log group:', error);
		}
	}
}

/**
 * Report an error to the error tracking service
 */
export async function reportError(report: ErrorReport): Promise<void> {
	// Write to dedicated error log group (1 year retention)
	const logGroupWrite = writeToErrorLogGroup(report).catch((error) => {
		// Log but don't throw - don't let logging failures affect the app
		console.error('Error writing to CloudWatch log group:', error);
	});

	const dsn = process.env.ERROR_REPORTING_DSN;
	if (!dsn) {
		await logGroupWrite;
		return;
	}

	try {
		// Parse DSN to extract components
		const dsnUrl = new URL(dsn);
		const publicKey = dsnUrl.username;
		const projectId = dsnUrl.pathname.slice(1);
		const host = dsnUrl.host;

		// Generate event ID
		const eventId = randomUUID().replace(/-/g, '');

		// Parse stack trace into frames
		const frames = parseStackTrace(report.stack);

		// Build envelope header
		const envelopeHeader = JSON.stringify({
			event_id: eventId,
			sent_at: new Date().toISOString(),
			dsn,
		});

		// Build event payload
		const event: Record<string, unknown> = {
			event_id: eventId,
			timestamp: report.timestamp / 1000,
			platform: report.source === 'web' ? 'javascript' : 'node',
			environment: report.environment || 'production',
			tags: {
				source: report.source,
			},
			exception: {
				values: [
					{
						type: report.name,
						value: report.message,
						stacktrace: frames.length > 0 ? { frames } : undefined,
					},
				],
			},
		};

		// Add optional fields
		if (report.userId) {
			event.user = { id: report.userId };
		}

		if (report.url || report.userAgent) {
			event.request = {
				url: report.url,
				headers: report.userAgent ? { 'User-Agent': report.userAgent } : undefined,
			};
		}

		if (report.extra) {
			event.extra = report.extra;
		}

		// Build item header
		const itemHeader = JSON.stringify({
			type: 'event',
			length: JSON.stringify(event).length,
		});

		// Construct envelope (newline-separated)
		const envelope = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}`;

		// Forward to error tracking service
		const response = await fetch(`https://${host}/api/${projectId}/envelope/`, {
			method: 'POST',
			body: envelope,
			headers: {
				'Content-Type': 'application/x-sentry-envelope',
				'X-Sentry-Auth': `Sentry sentry_key=${publicKey}, sentry_version=7`,
			},
		});

		if (!response.ok) {
			console.error('Error reporting failed:', response.status);
		}
	} catch (error) {
		console.error('Error reporting failed:', error);
	}

	await logGroupWrite;
}

/**
 * Convenience function to report a caught error
 */
export function captureException(
	error: Error,
	source: 'api' | 'mcp' | 'frontend',
	extra?: Record<string, unknown>
): void {
	reportError({
		name: error.name,
		message: error.message,
		stack: error.stack,
		timestamp: Date.now(),
		source,
		environment: process.env.NODE_ENV,
		extra,
	}).catch(() => {
		// Silently fail
	});
}

let handlersInstalled = false;
let handlingFatalError = false;

const FATAL_FLUSH_TIMEOUT_MS = 2500;

/**
 * Report a fatal error, then exit so the orchestrator replaces the task.
 * Merely logging would leave the process serving requests from an undefined
 * state while health checks keep passing.
 */
export function handleFatalError(
	reason: unknown,
	source: 'api' | 'mcp' | 'frontend',
	type: 'uncaught_exception' | 'unhandled_rejection'
): void {
	const error = reason instanceof Error ? reason : new Error(String(reason));
	console.error(
		type === 'uncaught_exception' ? 'Uncaught exception:' : 'Unhandled rejection:',
		error
	);

	// An error thrown while already flushing must not schedule a second exit
	if (handlingFatalError) {
		return;
	}
	handlingFatalError = true;

	const flush = reportError({
		name: error.name,
		message: error.message,
		stack: error.stack,
		timestamp: Date.now(),
		source,
		environment: process.env.NODE_ENV,
		extra: { type },
	});
	const timeout = new Promise<void>((resolve) => {
		setTimeout(resolve, FATAL_FLUSH_TIMEOUT_MS).unref();
	});
	void Promise.race([flush, timeout])
		.catch(() => {})
		.finally(() => process.exit(1));
}

/**
 * Install global error handlers for uncaught exceptions and unhandled rejections.
 * Call this once at application startup.
 */
export function installErrorHandlers(source: 'api' | 'mcp' | 'frontend'): void {
	// Prevent duplicate handler installation
	if (handlersInstalled) {
		return;
	}
	handlersInstalled = true;

	process.on('uncaughtException', (error: Error) => {
		handleFatalError(error, source, 'uncaught_exception');
	});

	process.on('unhandledRejection', (reason: unknown) => {
		handleFatalError(reason, source, 'unhandled_rejection');
	});
}

/**
 * Split "filename:line:col" (or "filename:line", or a bare filename) apart.
 *
 * Both regexes hold a single greedy `.*` against anchors and required digits, so
 * there is one unambiguous way to split any input. The previous parser chained two
 * lazy `(.+?)` groups with optional trailing groups, which let the engine retry
 * every split point and made frame parsing quadratic (CodeQL js/polynomial-redos).
 */
function parseLocation(location: string): { filename: string; lineno?: number; colno?: number } {
	const withColumn = location.match(/^(.*):(\d+):(\d+)$/);
	if (withColumn) {
		return {
			filename: withColumn[1] as string,
			lineno: parseInt(withColumn[2] as string, 10),
			colno: parseInt(withColumn[3] as string, 10),
		};
	}

	const withLine = location.match(/^(.*):(\d+)$/);
	if (withLine) {
		return { filename: withLine[1] as string, lineno: parseInt(withLine[2] as string, 10) };
	}

	return { filename: location };
}

/** Split a Chrome/Node frame body ("fn (loc)" or a bare "loc") into function and location. */
function splitFrame(body: string): { filename: string; function: string; lineno?: number; colno?: number } {
	if (body.endsWith(')')) {
		const open = body.lastIndexOf(' (');
		if (open > 0) {
			return {
				function: body.slice(0, open),
				...parseLocation(body.slice(open + 2, -1)),
			};
		}
	}
	return { function: '<anonymous>', ...parseLocation(body) };
}

/**
 * Parse a stack trace string into frames (exported for testing)
 */
export function parseStackTrace(stack?: string): Array<{
	filename: string;
	function: string;
	lineno?: number;
	colno?: number;
}> {
	if (!stack) return [];

	const frames: Array<{
		filename: string;
		function: string;
		lineno?: number;
		colno?: number;
	}> = [];

	const lines = stack.split('\n');

	for (const line of lines) {
		// Chrome/Node: "    at functionName (filename:line:col)" or bare "    at filename:line:col"
		const chromeMatch = line.match(/^\s*at\s+(.+)$/);
		if (chromeMatch) {
			frames.push(splitFrame(chromeMatch[1] as string));
			continue;
		}

		// Firefox: "functionName@filename:line:col"
		const separator = line.indexOf('@');
		if (separator > 0 && separator < line.length - 1) {
			frames.push({
				function: line.slice(0, separator),
				...parseLocation(line.slice(separator + 1)),
			});
		}
	}

	// Reverse frames (error tracking services expect innermost frame first)
	return frames.reverse();
}
