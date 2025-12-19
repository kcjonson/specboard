import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class DocPlatformStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Infrastructure will be added here:
		// - ECS Fargate for API
		// - Aurora Serverless v2 for database
		// - Cognito for authentication
		// - S3 for file storage
		// - CloudFront for CDN
	}
}
