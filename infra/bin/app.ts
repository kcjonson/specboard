#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DocPlatformStack } from '../lib/doc-platform-stack';
import { getEnvironmentConfig } from '../lib/environment-config';

const app = new cdk.App();

// Select environment via --context env=staging|production (default: staging)
const envName = app.node.tryGetContext('env') ?? 'staging';
const config = getEnvironmentConfig(envName, {
	hostedZoneId: app.node.tryGetContext('hostedZoneId'),
	certificateArn: app.node.tryGetContext('certificateArn'),
	alarmEmail: app.node.tryGetContext('alarmEmail'),
});

new DocPlatformStack(app, config.stackName, {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
	},
	config,
});
