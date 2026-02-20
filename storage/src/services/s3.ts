/**
 * S3 operations for file content storage.
 */

import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
	CreateBucketCommand,
} from '@aws-sdk/client-s3';

// S3 client configuration
const s3Config: ConstructorParameters<typeof S3Client>[0] = {
	region: process.env.S3_REGION || 'us-west-2',
};

// LocalStack endpoint for local development
if (process.env.AWS_ENDPOINT_URL) {
	s3Config.endpoint = process.env.AWS_ENDPOINT_URL;
	s3Config.forcePathStyle = true; // Required for LocalStack
}

const s3 = new S3Client(s3Config);
const BUCKET = process.env.S3_BUCKET || 'specboard-storage';

/**
 * Type guard for AWS SDK errors.
 */
function isAwsError(error: unknown): error is { name: string } {
	return typeof error === 'object' && error !== null && 'name' in error;
}

/**
 * Get error name from AWS SDK error.
 */
function getErrorName(error: unknown): string | undefined {
	return isAwsError(error) ? error.name : undefined;
}

// Ensure bucket exists (for LocalStack in dev)
async function ensureBucket(): Promise<void> {
	if (!process.env.AWS_ENDPOINT_URL) return; // Only for LocalStack

	try {
		await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
		console.log(`Created S3 bucket: ${BUCKET}`);
	} catch (error: unknown) {
		const errorName = getErrorName(error);
		// Ignore if bucket already exists
		if (errorName === 'BucketAlreadyOwnedByYou' || errorName === 'BucketAlreadyExists') {
			console.log('Bucket already exists');
			return;
		}
		throw error;
	}
}

// Initialize bucket on module load
ensureBucket().catch(console.error);

/**
 * Build S3 key for a project file.
 */
function fileKey(projectId: string, path: string): string {
	return `${projectId}/files/${path}`;
}

/**
 * Build S3 key for a pending change (large files only).
 */
function pendingKey(projectId: string, userId: string, path: string): string {
	return `${projectId}/pending/${userId}/${path}`;
}

/**
 * Get file content from S3.
 */
export async function getFileContent(projectId: string, path: string): Promise<string | null> {
	try {
		const response = await s3.send(
			new GetObjectCommand({
				Bucket: BUCKET,
				Key: fileKey(projectId, path),
			})
		);
		return (await response.Body?.transformToString()) ?? null;
	} catch (error: unknown) {
		if (getErrorName(error) === 'NoSuchKey') {
			return null;
		}
		throw error;
	}
}

/**
 * Put file content to S3.
 */
export async function putFileContent(
	projectId: string,
	path: string,
	content: string
): Promise<void> {
	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: fileKey(projectId, path),
			Body: content,
			ContentType: 'text/plain; charset=utf-8',
			ServerSideEncryption: 'AES256', // Explicit encryption (defense-in-depth)
		})
	);
}

/**
 * Delete file from S3.
 */
export async function deleteFileContent(projectId: string, path: string): Promise<void> {
	await s3.send(
		new DeleteObjectCommand({
			Bucket: BUCKET,
			Key: fileKey(projectId, path),
		})
	);
}

/**
 * Get pending content from S3 (for large files).
 */
export async function getPendingContent(
	projectId: string,
	userId: string,
	path: string
): Promise<string | null> {
	try {
		const response = await s3.send(
			new GetObjectCommand({
				Bucket: BUCKET,
				Key: pendingKey(projectId, userId, path),
			})
		);
		return (await response.Body?.transformToString()) ?? null;
	} catch (error: unknown) {
		if (getErrorName(error) === 'NoSuchKey') {
			return null;
		}
		throw error;
	}
}

/**
 * Put pending content to S3 (for large files).
 */
export async function putPendingContent(
	projectId: string,
	userId: string,
	path: string,
	content: string
): Promise<void> {
	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: pendingKey(projectId, userId, path),
			Body: content,
			ContentType: 'text/plain; charset=utf-8',
			ServerSideEncryption: 'AES256', // Explicit encryption (defense-in-depth)
		})
	);
}

/**
 * Delete pending content from S3.
 */
export async function deletePendingContent(
	projectId: string,
	userId: string,
	path: string
): Promise<void> {
	await s3.send(
		new DeleteObjectCommand({
			Bucket: BUCKET,
			Key: pendingKey(projectId, userId, path),
		})
	);
}

/**
 * List all files for a project in S3.
 */
export async function listS3Files(projectId: string): Promise<string[]> {
	const prefix = `${projectId}/files/`;
	const paths: string[] = [];

	let continuationToken: string | undefined;
	do {
		const response = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			})
		);

		for (const object of response.Contents ?? []) {
			if (object.Key) {
				// Remove prefix to get relative path
				paths.push(object.Key.slice(prefix.length));
			}
		}

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return paths;
}
