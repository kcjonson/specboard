#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SpecboardStack } from '../lib/specboard-stack';
import { getEnvironmentConfig } from '../lib/environment-config';

const app = new cdk.App();

// Select environment via --context env=staging|production (default: staging)
const envName = app.node.tryGetContext('env') ?? 'staging';
const config = getEnvironmentConfig(envName, {
	hostedZoneId: app.node.tryGetContext('hostedZoneId'),
	certificateArn: app.node.tryGetContext('certificateArn'),
	alarmEmail: app.node.tryGetContext('alarmEmail'),
});

const stack = new SpecboardStack(app, config.stackName, {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
	},
	config,
});

// Tags propagate to every taggable resource in the stack.
// Used by: Cost Explorer (cost allocation tags), Resource Groups, console filtering.
cdk.Tags.of(stack).add('Project', 'specboard');
cdk.Tags.of(stack).add('Environment', config.name);
cdk.Tags.of(stack).add('ManagedBy', 'cdk');
