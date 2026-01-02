import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class DocPlatformStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Bootstrap mode: deploy with desiredCount=0 so services don't fail when images don't exist
		// Usage: npx cdk deploy --context bootstrap=true
		const isBootstrap = this.node.tryGetContext('bootstrap') === 'true';

		// ===========================================
		// VPC
		// ===========================================
		const vpc = new ec2.Vpc(this, 'Vpc', {
			maxAzs: 2,
			natGateways: 1, // Cost optimization: 1 NAT gateway for staging
			subnetConfiguration: [
				{
					cidrMask: 24,
					name: 'Public',
					subnetType: ec2.SubnetType.PUBLIC,
				},
				{
					cidrMask: 24,
					name: 'Private',
					subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
				},
				{
					cidrMask: 24,
					name: 'Isolated',
					subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
				},
			],
		});

		// ===========================================
		// DNS & SSL
		// ===========================================
		const domainName = 'specboard.io';
		const stagingSubdomain = 'staging';
		const stagingDomain = `${stagingSubdomain}.${domainName}`;

		// Route53 Hosted Zone for specboard.io
		const hostedZone = new route53.HostedZone(this, 'HostedZone', {
			zoneName: domainName,
			comment: 'Managed by CDK - doc-platform',
		});

		// ACM Certificate - wildcard for all subdomains + apex domain (us-west-2 for ALB)
		const certificate = new acm.Certificate(this, 'Certificate', {
			domainName: domainName,
			subjectAlternativeNames: [`*.${domainName}`],
			validation: acm.CertificateValidation.fromDns(hostedZone),
		});


		// ===========================================
		// ECR Repositories
		// ===========================================
		// ECR repos use RETAIN so they survive failed deployments
		// (services fail on first deploy if images don't exist yet)
		// Lifecycle policy keeps last 3 images for rollback, deletes older ones
		const ecrLifecycleRules: ecr.LifecycleRule[] = [
			{
				description: 'Keep last 3 images for rollback',
				maxImageCount: 3,
				rulePriority: 1,
				tagStatus: ecr.TagStatus.ANY,
			},
		];

		const apiRepository = new ecr.Repository(this, 'ApiRepository', {
			repositoryName: 'doc-platform/api',
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			lifecycleRules: ecrLifecycleRules,
		});

		const frontendRepository = new ecr.Repository(this, 'FrontendRepository', {
			repositoryName: 'doc-platform/frontend',
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			lifecycleRules: ecrLifecycleRules,
		});

		const mcpRepository = new ecr.Repository(this, 'McpRepository', {
			repositoryName: 'doc-platform/mcp',
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			lifecycleRules: ecrLifecycleRules,
		});

		// ===========================================
		// RDS PostgreSQL (Single-AZ for staging)
		// ===========================================
		const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
			vpc,
			description: 'Security group for RDS PostgreSQL',
			allowAllOutbound: false,
		});

		const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
			secretName: 'doc-platform/db-credentials',
			generateSecretString: {
				secretStringTemplate: JSON.stringify({ username: 'postgres' }),
				generateStringKey: 'password',
				excludePunctuation: true,
				passwordLength: 32,
			},
		});

		// Invite keys for signup gating (comma-separated list)
		// Set this secret value in AWS Secrets Manager or via GitHub Actions
		const inviteKeysSecret = new secretsmanager.Secret(this, 'InviteKeys', {
			secretName: 'doc-platform/invite-keys',
			description: 'Comma-separated list of valid invite keys for signup',
		});

		const database = new rds.DatabaseInstance(this, 'Database', {
			engine: rds.DatabaseInstanceEngine.postgres({
				version: rds.PostgresEngineVersion.VER_16,
			}),
			instanceType: ec2.InstanceType.of(
				ec2.InstanceClass.T4G,
				ec2.InstanceSize.MICRO
			),
			vpc,
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
			securityGroups: [dbSecurityGroup],
			credentials: rds.Credentials.fromSecret(dbCredentials),
			databaseName: 'doc_platform',
			allocatedStorage: 20,
			maxAllocatedStorage: 100,
			multiAz: false, // Single-AZ for staging (cost optimization)
			deletionProtection: false,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			backupRetention: cdk.Duration.days(1),
		});

		// ===========================================
		// ElastiCache Redis
		// ===========================================
		const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
			vpc,
			description: 'Security group for ElastiCache Redis',
			allowAllOutbound: false,
		});

		const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
			description: 'Subnet group for Redis',
			subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
			cacheSubnetGroupName: 'doc-platform-redis-subnet-group',
		});

		const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
			cacheNodeType: 'cache.t4g.micro',
			engine: 'redis',
			numCacheNodes: 1,
			vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
			cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
		});
		redis.addDependency(redisSubnetGroup);

		// ===========================================
		// ECS Cluster
		// ===========================================
		const cluster = new ecs.Cluster(this, 'Cluster', {
			vpc,
			clusterName: 'doc-platform',
			containerInsights: true,
		});

		// ===========================================
		// Application Load Balancer
		// ===========================================
		const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
			vpc,
			internetFacing: true,
			loadBalancerName: 'doc-platform-alb',
		});

		// HTTPS Listener (primary)
		const httpsListener = alb.addListener('HttpsListener', {
			port: 443,
			protocol: elbv2.ApplicationProtocol.HTTPS,
			certificates: [certificate],
			sslPolicy: elbv2.SslPolicy.TLS12,
			open: true,
		});

		// HTTP Listener - redirect to HTTPS
		alb.addListener('HttpListener', {
			port: 80,
			open: true,
			defaultAction: elbv2.ListenerAction.redirect({
				protocol: 'HTTPS',
				port: '443',
				permanent: true,
			}),
		});

		// DNS A Record for staging.specboard.io -> ALB
		new route53.ARecord(this, 'StagingARecord', {
			zone: hostedZone,
			recordName: stagingSubdomain,
			target: route53.RecordTarget.fromAlias(
				new route53Targets.LoadBalancerTarget(alb)
			),
			comment: 'Staging environment ALB',
		});

		// ===========================================
		// Security Groups for ECS Services
		// ===========================================
		const apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
			vpc,
			description: 'Security group for API service',
			allowAllOutbound: true,
		});

		const frontendSecurityGroup = new ec2.SecurityGroup(this, 'FrontendSecurityGroup', {
			vpc,
			description: 'Security group for Frontend service',
			allowAllOutbound: true,
		});

		const mcpSecurityGroup = new ec2.SecurityGroup(this, 'McpSecurityGroup', {
			vpc,
			description: 'Security group for MCP service',
			allowAllOutbound: true,
		});

		// Allow ALB to reach services
		apiSecurityGroup.addIngressRule(
			ec2.Peer.securityGroupId(alb.connections.securityGroups[0]!.securityGroupId),
			ec2.Port.tcp(3001),
			'Allow ALB to API'
		);
		frontendSecurityGroup.addIngressRule(
			ec2.Peer.securityGroupId(alb.connections.securityGroups[0]!.securityGroupId),
			ec2.Port.tcp(3000),
			'Allow ALB to Frontend'
		);

		// Allow MCP to reach API (internal service-to-service)
		apiSecurityGroup.addIngressRule(
			mcpSecurityGroup,
			ec2.Port.tcp(3001),
			'Allow MCP to API'
		);

		// Allow services to reach database
		dbSecurityGroup.addIngressRule(
			apiSecurityGroup,
			ec2.Port.tcp(5432),
			'Allow API to PostgreSQL'
		);
		dbSecurityGroup.addIngressRule(
			mcpSecurityGroup,
			ec2.Port.tcp(5432),
			'Allow MCP to PostgreSQL'
		);

		// Allow services to reach Redis
		redisSecurityGroup.addIngressRule(
			apiSecurityGroup,
			ec2.Port.tcp(6379),
			'Allow API to Redis'
		);
		redisSecurityGroup.addIngressRule(
			frontendSecurityGroup,
			ec2.Port.tcp(6379),
			'Allow Frontend to Redis'
		);

		// ===========================================
		// Log Groups
		// ===========================================
		// Error logs - 1 year retention for debugging and compliance
		// Uses custom resource to handle "already exists" case (e.g., after failed deployments)
		// Note: No onDelete handler = log group is retained on stack deletion (equivalent to RETAIN policy)
		const errorLogGroupName = '/doc-platform/errors';
		const errorLogGroupArn = cdk.Stack.of(this).formatArn({
			service: 'logs',
			resource: 'log-group',
			resourceName: `${errorLogGroupName}:*`,
		});

		const ensureErrorLogGroup = new cr.AwsCustomResource(this, 'EnsureErrorLogGroup', {
			onCreate: {
				service: 'CloudWatchLogs',
				action: 'createLogGroup',
				parameters: { logGroupName: errorLogGroupName },
				physicalResourceId: cr.PhysicalResourceId.of(errorLogGroupName),
				ignoreErrorCodesMatching: 'ResourceAlreadyExistsException',
			},
			onUpdate: {
				service: 'CloudWatchLogs',
				action: 'createLogGroup',
				parameters: { logGroupName: errorLogGroupName },
				physicalResourceId: cr.PhysicalResourceId.of(errorLogGroupName),
				ignoreErrorCodesMatching: 'ResourceAlreadyExistsException',
			},
			policy: cr.AwsCustomResourcePolicy.fromStatements([
				new iam.PolicyStatement({
					actions: ['logs:CreateLogGroup'],
					resources: [errorLogGroupArn],
				}),
			]),
		});

		const setErrorLogRetention = new cr.AwsCustomResource(this, 'SetErrorLogRetention', {
			onCreate: {
				service: 'CloudWatchLogs',
				action: 'putRetentionPolicy',
				parameters: { logGroupName: errorLogGroupName, retentionInDays: 365 },
				physicalResourceId: cr.PhysicalResourceId.of(`${errorLogGroupName}-retention`),
			},
			onUpdate: {
				service: 'CloudWatchLogs',
				action: 'putRetentionPolicy',
				parameters: { logGroupName: errorLogGroupName, retentionInDays: 365 },
				physicalResourceId: cr.PhysicalResourceId.of(`${errorLogGroupName}-retention`),
			},
			policy: cr.AwsCustomResourcePolicy.fromStatements([
				new iam.PolicyStatement({
					actions: ['logs:PutRetentionPolicy'],
					resources: [errorLogGroupArn],
				}),
			]),
		});

		// Ensure log group exists before setting retention policy
		setErrorLogRetention.node.addDependency(ensureErrorLogGroup);

		const errorLogGroup = logs.LogGroup.fromLogGroupName(this, 'ErrorLogGroup', errorLogGroupName);

		// ===========================================
		// API Service (Fargate)
		// ===========================================
		// Access logs - 30 days retention
		const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
			logGroupName: '/ecs/api',
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const apiTaskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
			memoryLimitMiB: 512,
			cpu: 256,
		});

		apiTaskDefinition.addContainer('api', {
			image: ecs.ContainerImage.fromEcrRepository(apiRepository, 'latest'),
			logging: ecs.LogDrivers.awsLogs({
				logGroup: apiLogGroup,
				streamPrefix: 'api',
			}),
			environment: {
				PORT: '3001',
				NODE_ENV: 'production',
				APP_ENV: 'staging',
				REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
				// Database connection built from components
				DB_HOST: database.instanceEndpoint.hostname,
				DB_PORT: database.instanceEndpoint.port.toString(),
				DB_NAME: 'doc_platform',
				DB_USER: 'postgres',
				// Error logging
				ERROR_LOG_GROUP: errorLogGroup.logGroupName,
				// Email service (SES)
				SES_REGION: 'us-west-2',
				EMAIL_FROM: `noreply@${domainName}`,
				APP_URL: `https://${stagingDomain}`,
				// Email safety: only send to team domains in staging
				EMAIL_ALLOWLIST: 'specboard.io',
			},
			secrets: {
				DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, 'password'),
				INVITE_KEYS: ecs.Secret.fromSecretsManager(inviteKeysSecret),
			},
			portMappings: [{ containerPort: 3001 }],
			healthCheck: {
				command: ['CMD-SHELL', 'node -e "fetch(\'http://localhost:3001/api/health\').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'],
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
				retries: 3,
				startPeriod: cdk.Duration.seconds(60),
			},
		});

		const apiService = new ecs.FargateService(this, 'ApiService', {
			cluster,
			taskDefinition: apiTaskDefinition,
			desiredCount: isBootstrap ? 0 : 1,
			securityGroups: [apiSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'api',
			circuitBreaker: { enable: true, rollback: true },
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// Grant API task permission to write to error log group
		errorLogGroup.grantWrite(apiTaskDefinition.taskRole);

		// Grant API task permission to send emails via SES
		// Scoped to domain identity to follow least privilege principle
		const sesIdentityArn = cdk.Arn.format({
			service: 'ses',
			resource: 'identity',
			resourceName: domainName,
			region: this.region,
			account: this.account,
		}, this);
		apiTaskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
			actions: ['ses:SendEmail', 'ses:SendRawEmail'],
			resources: [sesIdentityArn],
		}));

		// ===========================================
		// Frontend Service (Fargate)
		// ===========================================
		const frontendTaskDefinition = new ecs.FargateTaskDefinition(this, 'FrontendTaskDef', {
			memoryLimitMiB: 512,
			cpu: 256,
		});

		frontendTaskDefinition.addContainer('frontend', {
			image: ecs.ContainerImage.fromEcrRepository(frontendRepository, 'latest'),
			logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'frontend' }),
			environment: {
				PORT: '3000',
				NODE_ENV: 'production',
				// Frontend calls API through the staging domain
				API_URL: `https://${stagingDomain}`,
				REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
				// Database connection (required by @doc-platform/db imported via @doc-platform/auth)
				DB_HOST: database.instanceEndpoint.hostname,
				DB_PORT: database.instanceEndpoint.port.toString(),
				DB_NAME: 'doc_platform',
				DB_USER: 'postgres',
			},
			secrets: {
				DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, 'password'),
			},
			portMappings: [{ containerPort: 3000 }],
			healthCheck: {
				command: ['CMD-SHELL', 'node -e "fetch(\'http://localhost:3000/health\').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'],
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
				retries: 3,
				startPeriod: cdk.Duration.seconds(60),
			},
		});

		const frontendService = new ecs.FargateService(this, 'FrontendService', {
			cluster,
			taskDefinition: frontendTaskDefinition,
			desiredCount: isBootstrap ? 0 : 1,
			securityGroups: [frontendSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'frontend',
			circuitBreaker: { enable: true, rollback: true },
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// ===========================================
		// MCP Service (Fargate)
		// ===========================================
		// Access logs - 30 days retention
		const mcpLogGroup = new logs.LogGroup(this, 'McpLogGroup', {
			logGroupName: '/ecs/mcp',
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const mcpTaskDefinition = new ecs.FargateTaskDefinition(this, 'McpTaskDef', {
			memoryLimitMiB: 512,
			cpu: 256,
		});

		mcpTaskDefinition.addContainer('mcp', {
			image: ecs.ContainerImage.fromEcrRepository(mcpRepository, 'latest'),
			logging: ecs.LogDrivers.awsLogs({
				logGroup: mcpLogGroup,
				streamPrefix: 'mcp',
			}),
			environment: {
				PORT: '3002',
				NODE_ENV: 'production',
				// MCP calls API via staging domain
				API_URL: `https://${stagingDomain}`,
				// Database connection for direct DB access
				DB_HOST: database.instanceEndpoint.hostname,
				DB_PORT: database.instanceEndpoint.port.toString(),
				DB_NAME: 'doc_platform',
				DB_USER: 'postgres',
				// Error logging
				ERROR_LOG_GROUP: errorLogGroup.logGroupName,
			},
			secrets: {
				DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, 'password'),
			},
			portMappings: [{ containerPort: 3002 }],
			healthCheck: {
				command: ['CMD-SHELL', 'node -e "fetch(\'http://localhost:3002/health\').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'],
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
				retries: 3,
				startPeriod: cdk.Duration.seconds(60),
			},
		});

		new ecs.FargateService(this, 'McpService', {
			cluster,
			taskDefinition: mcpTaskDefinition,
			desiredCount: isBootstrap ? 0 : 1,
			securityGroups: [mcpSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'mcp',
			circuitBreaker: { enable: true, rollback: true },
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// Grant MCP task permission to write to error log group
		errorLogGroup.grantWrite(mcpTaskDefinition.taskRole);

		// ===========================================
		// ALB Target Groups & Routing
		// ===========================================
		const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
			vpc,
			port: 3001,
			protocol: elbv2.ApplicationProtocol.HTTP,
			targetType: elbv2.TargetType.IP,
			healthCheck: {
				path: '/api/health',
				interval: cdk.Duration.seconds(30),
				healthyThresholdCount: 2,
				unhealthyThresholdCount: 3,
			},
		});
		apiService.attachToApplicationTargetGroup(apiTargetGroup);

		const frontendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'FrontendTargetGroup', {
			vpc,
			port: 3000,
			protocol: elbv2.ApplicationProtocol.HTTP,
			targetType: elbv2.TargetType.IP,
			healthCheck: {
				path: '/health',
				interval: cdk.Duration.seconds(30),
				healthyThresholdCount: 2,
				unhealthyThresholdCount: 3,
			},
		});
		frontendService.attachToApplicationTargetGroup(frontendTargetGroup);

		// Path-based routing: /api/* -> API, everything else -> Frontend
		httpsListener.addTargetGroups('ApiRoutes', {
			targetGroups: [apiTargetGroup],
			priority: 10,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/api/*']),
			],
		});

		// OAuth endpoints -> API (not /oauth/consent which is SPA)
		httpsListener.addTargetGroups('OAuthRoutes', {
			targetGroups: [apiTargetGroup],
			priority: 20,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/oauth/authorize', '/oauth/token', '/oauth/revoke']),
			],
		});

		// .well-known endpoints -> API
		httpsListener.addTargetGroups('WellKnownRoutes', {
			targetGroups: [apiTargetGroup],
			priority: 30,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/.well-known/*']),
			],
		});

		httpsListener.addTargetGroups('DefaultRoute', {
			targetGroups: [frontendTargetGroup],
		});

		// ===========================================
		// CloudWatch Alarms
		// ===========================================

		// API Service CPU Alarm
		new cloudwatch.Alarm(this, 'ApiCpuAlarm', {
			alarmName: 'doc-platform-api-cpu-high',
			alarmDescription: 'API service CPU utilization exceeds 80%',
			metric: apiService.metricCpuUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		// API Service Memory Alarm
		new cloudwatch.Alarm(this, 'ApiMemoryAlarm', {
			alarmName: 'doc-platform-api-memory-high',
			alarmDescription: 'API service memory utilization exceeds 80%',
			metric: apiService.metricMemoryUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		// Frontend Service CPU Alarm
		new cloudwatch.Alarm(this, 'FrontendCpuAlarm', {
			alarmName: 'doc-platform-frontend-cpu-high',
			alarmDescription: 'Frontend service CPU utilization exceeds 80%',
			metric: frontendService.metricCpuUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		// Frontend Service Memory Alarm
		new cloudwatch.Alarm(this, 'FrontendMemoryAlarm', {
			alarmName: 'doc-platform-frontend-memory-high',
			alarmDescription: 'Frontend service memory utilization exceeds 80%',
			metric: frontendService.metricMemoryUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		// ALB 5xx Error Alarm
		new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
			alarmName: 'doc-platform-alb-5xx-errors',
			alarmDescription: 'ALB 5xx errors exceed 10 in 5 minutes',
			metric: alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 10,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		// Target 5xx Error Alarm (errors from API/Frontend services)
		new cloudwatch.Alarm(this, 'Target5xxAlarm', {
			alarmName: 'doc-platform-target-5xx-errors',
			alarmDescription: 'Target 5xx errors exceed 10 in 5 minutes',
			metric: alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 10,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		// ===========================================
		// GitHub Actions OIDC & IAM Role
		// ===========================================
		const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
			url: 'https://token.actions.githubusercontent.com',
			clientIds: ['sts.amazonaws.com'],
			thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
		});

		const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
			roleName: 'doc-platform-github-actions-deploy',
			assumedBy: new iam.FederatedPrincipal(
				githubOidcProvider.openIdConnectProviderArn,
				{
					StringEquals: {
						'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
						'token.actions.githubusercontent.com:sub': 'repo:kcjonson/doc-platform:ref:refs/heads/main',
					},
				},
				'sts:AssumeRoleWithWebIdentity'
			),
			description: 'Role for GitHub Actions to deploy to ECS',
		});

		// ECR permissions - GetAuthorizationToken requires * resource
		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecr:GetAuthorizationToken'],
			resources: ['*'],
		}));

		// ECR permissions - push images to specific repositories
		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: [
				'ecr:BatchCheckLayerAvailability',
				'ecr:GetDownloadUrlForLayer',
				'ecr:BatchGetImage',
				'ecr:PutImage',
				'ecr:InitiateLayerUpload',
				'ecr:UploadLayerPart',
				'ecr:CompleteLayerUpload',
			],
			resources: [
				apiRepository.repositoryArn,
				frontendRepository.repositoryArn,
				mcpRepository.repositoryArn,
			],
		}));

		// ECS permissions - consolidated (DescribeServices/Tasks need * for waiters)
		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: [
				'ecs:DescribeServices',
				'ecs:DescribeTasks',
				'ecs:DescribeTaskDefinition',
			],
			resources: ['*'],
		}));

		// ECS permissions - scoped to cluster for mutations
		const serviceArnPattern = `arn:aws:ecs:${this.region}:${this.account}:service/${cluster.clusterName}/*`;
		const taskArnPattern = `arn:aws:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`;
		// Use wildcard for task definition revisions - specific ARN breaks when CDK updates the revision
		const taskDefArnPattern = `arn:aws:ecs:${this.region}:${this.account}:task-definition/${apiTaskDefinition.family}:*`;

		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecs:UpdateService'],
			resources: [serviceArnPattern],
		}));

		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecs:RunTask'],
			resources: [taskDefArnPattern],
		}));

		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecs:StopTask'],
			resources: [taskArnPattern],
		}));

		// Pass role to ECS tasks
		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['iam:PassRole'],
			resources: [
				apiTaskDefinition.taskRole.roleArn,
				apiTaskDefinition.executionRole!.roleArn,
			],
		}));

		// CloudFormation - read stack outputs
		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['cloudformation:DescribeStacks'],
			resources: [this.stackId],
		}));

		// CDK deployment - assume CDK bootstrap roles (created by `cdk bootstrap`)
		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['sts:AssumeRole'],
			resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
		}));

		// CloudWatch Logs - scoped to API log group for viewing migration logs
		deployRole.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: [
				'logs:GetLogEvents',
				'logs:DescribeLogStreams',
			],
			resources: [apiLogGroup.logGroupArn, `${apiLogGroup.logGroupArn}:*`],
		}));

		// ===========================================
		// Outputs
		// ===========================================
		new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
			value: deployRole.roleArn,
			description: 'ARN of IAM role for GitHub Actions deployment',
		});

		new cdk.CfnOutput(this, 'AlbDnsName', {
			value: alb.loadBalancerDnsName,
			description: 'Application Load Balancer DNS Name',
		});

		new cdk.CfnOutput(this, 'ApiRepositoryUri', {
			value: apiRepository.repositoryUri,
			description: 'ECR Repository URI for API',
		});

		new cdk.CfnOutput(this, 'FrontendRepositoryUri', {
			value: frontendRepository.repositoryUri,
			description: 'ECR Repository URI for Frontend',
		});

		new cdk.CfnOutput(this, 'McpRepositoryUri', {
			value: mcpRepository.repositoryUri,
			description: 'ECR Repository URI for MCP',
		});

		new cdk.CfnOutput(this, 'ClusterName', {
			value: cluster.clusterName,
			description: 'ECS Cluster Name',
		});

		new cdk.CfnOutput(this, 'DatabaseEndpoint', {
			value: database.instanceEndpoint.hostname,
			description: 'RDS PostgreSQL Endpoint',
		});

		new cdk.CfnOutput(this, 'RedisEndpoint', {
			value: redis.attrRedisEndpointAddress,
			description: 'ElastiCache Redis Endpoint',
		});

		new cdk.CfnOutput(this, 'ApiTaskDefinitionArn', {
			value: apiTaskDefinition.taskDefinitionArn,
			description: 'API Task Definition ARN (for running migrations)',
		});

		new cdk.CfnOutput(this, 'PrivateSubnetIds', {
			value: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds.join(','),
			description: 'Private subnet IDs for ECS tasks',
		});

		new cdk.CfnOutput(this, 'ApiSecurityGroupId', {
			value: apiSecurityGroup.securityGroupId,
			description: 'API security group ID',
		});

		new cdk.CfnOutput(this, 'ApiLogGroupName', {
			value: apiLogGroup.logGroupName,
			description: 'API CloudWatch Log Group name',
		});

		new cdk.CfnOutput(this, 'HostedZoneId', {
			value: hostedZone.hostedZoneId,
			description: 'Route53 Hosted Zone ID',
		});

		new cdk.CfnOutput(this, 'HostedZoneNameServers', {
			value: cdk.Fn.join(', ', hostedZone.hostedZoneNameServers || []),
			description: 'Route53 Nameservers - update these in GoDaddy',
		});

		new cdk.CfnOutput(this, 'CertificateArn', {
			value: certificate.certificateArn,
			description: 'ACM Certificate ARN',
		});

		new cdk.CfnOutput(this, 'StagingUrl', {
			value: `https://${stagingDomain}`,
			description: 'Staging environment URL',
		});

	}
}
