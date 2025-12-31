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
	source: 'web' | 'api' | 'mcp';
	environment?: string;
	extra?: Record<string, unknown>;
}

// Lazy-initialized CloudWatch client
let cloudWatchClient: CloudWatchLogsClient | null = null;
let logStreamName: string | null = null;

function getCloudWatchClient(): CloudWatchLogsClient {
	if (!cloudWatchClient) {
		cloudWatchClient = new CloudWatchLogsClient({});
	}
	return cloudWatchClient;
}

function getLogStreamName(): string {
	if (!logStreamName) {
		// Use date + random suffix for stream name
		const date = new Date().toISOString().split('T')[0];
		logStreamName = `${date}-${randomUUID().slice(0, 8)}`;
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
	writeToErrorLogGroup(report).catch(() => {
		// Silently fail - don't let logging failures affect the app
	});

	const dsn = process.env.ERROR_REPORTING_DSN;
	if (!dsn) {
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
}

/**
 * Convenience function to report a caught error
 */
export function captureException(
	error: Error,
	source: 'api' | 'mcp',
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

/**
 * Install global error handlers for uncaught exceptions and unhandled rejections.
 * Call this once at application startup.
 */
export function installErrorHandlers(source: 'api' | 'mcp'): void {
	process.on('uncaughtException', (error: Error) => {
		console.error('Uncaught exception:', error);
		captureException(error, source, { type: 'uncaught_exception' });
	});

	process.on('unhandledRejection', (reason: unknown) => {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		console.error('Unhandled rejection:', error);
		captureException(error, source, { type: 'unhandled_rejection' });
	});
}

/**
 * Parse a stack trace string into frames
 */
function parseStackTrace(stack?: string): Array<{
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
		// Match Chrome/Node format: "    at functionName (filename:line:col)"
		const chromeMatch = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
		if (chromeMatch) {
			frames.push({
				function: chromeMatch[1] || '<anonymous>',
				filename: chromeMatch[2] || '',
				lineno: parseInt(chromeMatch[3] || '0', 10),
				colno: parseInt(chromeMatch[4] || '0', 10),
			});
			continue;
		}

		// Match Firefox format: "functionName@filename:line:col"
		const firefoxMatch = line.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
		if (firefoxMatch) {
			frames.push({
				function: firefoxMatch[1] || '<anonymous>',
				filename: firefoxMatch[2] || '',
				lineno: parseInt(firefoxMatch[3] || '0', 10),
				colno: parseInt(firefoxMatch[4] || '0', 10),
			});
		}
	}

	// Reverse frames (error tracking services expect innermost frame first)
	return frames.reverse();
}
