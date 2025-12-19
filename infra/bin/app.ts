#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DocPlatformStack } from '../lib/doc-platform-stack';

const app = new cdk.App();

new DocPlatformStack(app, 'DocPlatformStack', {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
	},
});
