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
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import * as path from 'path';
import { type EnvironmentConfig, getFullDomain } from './environment-config';

export interface DocPlatformStackProps extends cdk.StackProps {
	config: EnvironmentConfig;
}

export class DocPlatformStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: DocPlatformStackProps) {
		super(scope, id, props);

		const { config } = props;
		const isBootstrap = this.node.tryGetContext('bootstrap') === 'true';
		const isProduction = config.name === 'production';
		const fullDomain = getFullDomain(config);
		const githubSyncLambdaName = `${config.resourcePrefix}-github-sync`;

		// ===========================================
		// VPC
		// ===========================================
		const vpc = new ec2.Vpc(this, 'Vpc', {
			maxAzs: 2,
			natGateways: config.natGateways,
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
		let hostedZone: route53.IHostedZone;
		let certificate: acm.ICertificate;

		if (config.createSharedResources) {
			// Staging stack creates the zone and certificate (shared across environments)
			const zone = new route53.HostedZone(this, 'HostedZone', {
				zoneName: config.domain,
				comment: 'Managed by CDK - doc-platform',
			});
			hostedZone = zone;

			certificate = new acm.Certificate(this, 'Certificate', {
				domainName: config.domain,
				subjectAlternativeNames: [`*.${config.domain}`],
				validation: acm.CertificateValidation.fromDns(zone),
			});
		} else {
			// Production imports shared resources by ID/ARN (no cross-stack refs)
			hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
				hostedZoneId: config.shared!.hostedZoneId,
				zoneName: config.shared!.hostedZoneName,
			});
			certificate = acm.Certificate.fromCertificateArn(
				this, 'Certificate', config.shared!.certificateArn
			);
		}

		// ===========================================
		// ECR Repositories
		// ===========================================
		let apiRepository: ecr.IRepository;
		let frontendRepository: ecr.IRepository;
		let mcpRepository: ecr.IRepository;
		let storageRepository: ecr.IRepository;

		if (config.createSharedResources) {
			// Staging stack creates ECR repos (shared across environments).
			// Images are promoted by SHA tag, not rebuilt per environment.
			const ecrLifecycleRules: ecr.LifecycleRule[] = [
				{
					description: 'Keep last 20 images for SHA-based promotion',
					maxImageCount: 20,
					rulePriority: 1,
					tagStatus: ecr.TagStatus.ANY,
				},
			];

			const createRepo = (id: string, name: string): ecr.Repository =>
				new ecr.Repository(this, id, {
					repositoryName: name,
					// RETAIN: shared ECR repos serve both staging and production.
					// Destroying staging must not delete production images.
					removalPolicy: cdk.RemovalPolicy.RETAIN,
					lifecycleRules: ecrLifecycleRules,
					imageScanOnPush: true,
				});

			apiRepository = createRepo('ApiRepository', 'doc-platform/api');
			frontendRepository = createRepo('FrontendRepository', 'doc-platform/frontend');
			mcpRepository = createRepo('McpRepository', 'doc-platform/mcp');
			storageRepository = createRepo('StorageRepository', 'doc-platform/storage');
		} else {
			// Production imports ECR repos by name (no cross-stack refs)
			const repoNames = config.shared!.ecrRepoNames;
			apiRepository = ecr.Repository.fromRepositoryName(this, 'ApiRepository', repoNames.api);
			frontendRepository = ecr.Repository.fromRepositoryName(this, 'FrontendRepository', repoNames.frontend);
			mcpRepository = ecr.Repository.fromRepositoryName(this, 'McpRepository', repoNames.mcp);
			storageRepository = ecr.Repository.fromRepositoryName(this, 'StorageRepository', repoNames.storage);
		}

		// ===========================================
		// RDS PostgreSQL
		// ===========================================
		const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
			vpc,
			description: `Security group for ${config.name} RDS PostgreSQL`,
			allowAllOutbound: false,
		});

		const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
			secretName: `${config.secretsPrefix}/db-credentials`,
			generateSecretString: {
				secretStringTemplate: JSON.stringify({ username: 'postgres' }),
				generateStringKey: 'password',
				excludePunctuation: true,
				passwordLength: 32,
			},
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
		});

		const inviteKeysSecret = new secretsmanager.Secret(this, 'InviteKeys', {
			secretName: `${config.secretsPrefix}/invite-keys`,
			description: 'Comma-separated list of valid invite keys for signup',
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
		});

		// API key encryption key (AES-256 - 32 bytes / 64 hex chars)
		// After first deployment, manually set this secret to a valid hex key
		const apiKeyEncryptionSecret = new secretsmanager.Secret(this, 'ApiKeyEncryption', {
			secretName: `${config.secretsPrefix}/api-key-encryption`,
			description: 'AES-256 encryption key for user API keys - must be 64 hex characters. Set manually after deployment.',
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
		});

		const githubClientIdSecret = new secretsmanager.Secret(this, 'GitHubClientId', {
			secretName: `${config.secretsPrefix}/github-client-id`,
			description: `GitHub OAuth App client ID for ${fullDomain}`,
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
		});

		const githubClientSecretSecret = new secretsmanager.Secret(this, 'GitHubClientSecret', {
			secretName: `${config.secretsPrefix}/github-client-secret`,
			description: `GitHub OAuth App client secret for ${fullDomain}`,
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
		});

		const database = new rds.DatabaseInstance(this, 'Database', {
			engine: rds.DatabaseInstanceEngine.postgres({
				version: rds.PostgresEngineVersion.VER_16,
			}),
			instanceType: ec2.InstanceType.of(
				config.database.instanceClass,
				config.database.instanceSize
			),
			vpc,
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
			securityGroups: [dbSecurityGroup],
			credentials: rds.Credentials.fromSecret(dbCredentials),
			databaseName: 'doc_platform',
			allocatedStorage: 20,
			maxAllocatedStorage: 100,
			multiAz: config.database.multiAz,
			storageEncrypted: config.database.storageEncrypted,
			deletionProtection: config.database.deletionProtection,
			removalPolicy: isProduction ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
			backupRetention: cdk.Duration.days(config.database.backupRetentionDays),
		});

		// ===========================================
		// Storage Service Infrastructure (Separate DB + S3)
		// ===========================================
		const storageApiKeySecret = new secretsmanager.Secret(this, 'StorageApiKey', {
			secretName: `${config.secretsPrefix}/storage-api-key`,
			description: 'Internal API key for main API to call storage service',
			generateSecretString: {
				excludePunctuation: true,
				passwordLength: 64,
			},
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
		});

		const storageDbCredentials = new secretsmanager.Secret(this, 'StorageDbCredentials', {
			secretName: `${config.secretsPrefix}/storage-db-credentials`,
			generateSecretString: {
				secretStringTemplate: JSON.stringify({ username: 'postgres' }),
				generateStringKey: 'password',
				excludePunctuation: true,
				passwordLength: 32,
			},
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
		});

		const storageDbSecurityGroup = new ec2.SecurityGroup(this, 'StorageDbSecurityGroup', {
			vpc,
			description: `Security group for ${config.name} Storage Service RDS PostgreSQL`,
			allowAllOutbound: false,
		});

		const storageDatabase = new rds.DatabaseInstance(this, 'StorageDatabase', {
			engine: rds.DatabaseInstanceEngine.postgres({
				version: rds.PostgresEngineVersion.VER_16,
			}),
			instanceType: ec2.InstanceType.of(
				config.database.instanceClass,
				config.database.instanceSize
			),
			vpc,
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
			securityGroups: [storageDbSecurityGroup],
			credentials: rds.Credentials.fromSecret(storageDbCredentials),
			databaseName: 'storagedb',
			allocatedStorage: 20,
			maxAllocatedStorage: 100,
			multiAz: config.database.multiAz,
			storageEncrypted: config.database.storageEncrypted,
			deletionProtection: config.database.deletionProtection,
			removalPolicy: isProduction ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
			backupRetention: cdk.Duration.days(config.database.backupRetentionDays),
		});

		const storageBucket = new s3.Bucket(this, 'StorageBucket', {
			bucketName: `${config.resourcePrefix}-storage-${this.account}`,
			versioned: true,
			encryption: s3.BucketEncryption.S3_MANAGED,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: !isProduction,
			lifecycleRules: [{
				noncurrentVersionExpiration: cdk.Duration.days(30),
			}],
		});

		// ===========================================
		// ElastiCache Redis
		// ===========================================
		const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
			vpc,
			description: `Security group for ${config.name} ElastiCache Redis`,
			allowAllOutbound: false,
		});

		const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
			description: `Subnet group for ${config.name} Redis`,
			subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
			cacheSubnetGroupName: `${config.resourcePrefix}-redis-subnet-group`,
		});

		const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
			cacheNodeType: config.redisNodeType,
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
			clusterName: config.resourcePrefix,
			containerInsights: true,
		});

		// ===========================================
		// Application Load Balancer
		// ===========================================
		const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
			vpc,
			internetFacing: true,
			loadBalancerName: `${config.resourcePrefix}-alb`,
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

		// DNS A Record for this environment -> ALB
		// Staging keeps 'StagingARecord' construct ID for CloudFormation backward compatibility
		const aRecordProps: route53.ARecordProps = {
			zone: hostedZone,
			recordName: config.subdomain, // undefined = apex domain
			target: route53.RecordTarget.fromAlias(
				new route53Targets.LoadBalancerTarget(alb)
			),
			comment: `${config.name} environment ALB`,
		};
		new route53.ARecord(this, config.name === 'staging' ? 'StagingARecord' : 'ProductionARecord', aRecordProps);

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

		const storageSecurityGroup = new ec2.SecurityGroup(this, 'StorageSecurityGroup', {
			vpc,
			description: 'Security group for Storage service (internal only)',
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
		mcpSecurityGroup.addIngressRule(
			ec2.Peer.securityGroupId(alb.connections.securityGroups[0]!.securityGroupId),
			ec2.Port.tcp(3002),
			'Allow ALB to MCP'
		);

		// Allow MCP to reach API (internal service-to-service)
		apiSecurityGroup.addIngressRule(
			mcpSecurityGroup,
			ec2.Port.tcp(3001),
			'Allow MCP to API'
		);

		// Allow API to reach Storage service (internal service-to-service)
		storageSecurityGroup.addIngressRule(
			apiSecurityGroup,
			ec2.Port.tcp(3003),
			'Allow API to Storage'
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

		// Allow Storage service to reach its database
		storageDbSecurityGroup.addIngressRule(
			storageSecurityGroup,
			ec2.Port.tcp(5432),
			'Allow Storage to Storage-DB'
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
		const errorLogGroupName = `/${config.resourcePrefix}/errors`;
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

		setErrorLogRetention.node.addDependency(ensureErrorLogGroup);

		const errorLogGroup = logs.LogGroup.fromLogGroupName(this, 'ErrorLogGroup', errorLogGroupName);

		// ===========================================
		// API Service (Fargate)
		// ===========================================
		const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
			logGroupName: `/ecs/${config.logInfix}api`,
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const apiTaskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
			memoryLimitMiB: config.ecs.memory,
			cpu: config.ecs.cpu,
		});

		apiTaskDefinition.addContainer('api', {
			image: ecs.ContainerImage.fromEcrRepository(apiRepository, 'init'),
			logging: ecs.LogDrivers.awsLogs({
				logGroup: apiLogGroup,
				streamPrefix: 'api',
			}),
			environment: {
				PORT: '3001',
				NODE_ENV: 'production',
				APP_ENV: config.name,
				REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
				DB_HOST: database.instanceEndpoint.hostname,
				DB_PORT: database.instanceEndpoint.port.toString(),
				DB_NAME: 'doc_platform',
				DB_USER: 'postgres',
				ERROR_LOG_GROUP: errorLogGroup.logGroupName,
				SES_REGION: 'us-west-2',
				EMAIL_FROM: `noreply@${config.domain}`,
				APP_URL: `https://${fullDomain}`,
				EMAIL_ALLOWLIST: isProduction ? '' : 'specboard.io',
				STORAGE_SERVICE_URL: 'http://storage.internal:3003',
				GITHUB_SYNC_LAMBDA_NAME: githubSyncLambdaName,
				AWS_REGION: this.region,
			},
			secrets: {
				DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, 'password'),
				INVITE_KEYS: ecs.Secret.fromSecretsManager(inviteKeysSecret),
				API_KEY_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(apiKeyEncryptionSecret),
				GITHUB_CLIENT_ID: ecs.Secret.fromSecretsManager(githubClientIdSecret),
				GITHUB_CLIENT_SECRET: ecs.Secret.fromSecretsManager(githubClientSecretSecret),
				STORAGE_SERVICE_API_KEY: ecs.Secret.fromSecretsManager(storageApiKeySecret),
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

		// Alarm name referenced by deployment alarms — must match the
		// Target5xxAlarm construct defined in the CloudWatch section.
		const TARGET_5XX_ALARM_NAME = `${config.resourcePrefix}-target-5xx-errors`;

		const apiService = new ecs.FargateService(this, 'ApiService', {
			cluster,
			taskDefinition: apiTaskDefinition,
			desiredCount: isBootstrap ? 0 : config.ecs.desiredCount,
			securityGroups: [apiSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'api',
			circuitBreaker: { enable: true, rollback: true },
			deploymentAlarms: {
				alarmNames: [TARGET_5XX_ALARM_NAME],
				behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
			},
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// Grant API task permission to write to error log group
		errorLogGroup.grantWrite(apiTaskDefinition.taskRole);

		// Grant API task permission to send emails via SES
		const sesDomainArn = cdk.Arn.format({
			service: 'ses',
			resource: 'identity',
			resourceName: config.domain,
			region: this.region,
			account: this.account,
		}, this);
		const sesEmailWildcardArn = cdk.Arn.format({
			service: 'ses',
			resource: 'identity',
			resourceName: `*@${config.domain}`,
			region: this.region,
			account: this.account,
		}, this);
		apiTaskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
			actions: ['ses:SendEmail', 'ses:SendRawEmail'],
			resources: [sesDomainArn, sesEmailWildcardArn],
		}));

		// ===========================================
		// Frontend Service (Fargate)
		// ===========================================
		const frontendTaskDefinition = new ecs.FargateTaskDefinition(this, 'FrontendTaskDef', {
			memoryLimitMiB: config.ecs.memory,
			cpu: config.ecs.cpu,
		});

		frontendTaskDefinition.addContainer('frontend', {
			image: ecs.ContainerImage.fromEcrRepository(frontendRepository, 'init'),
			logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'frontend' }),
			environment: {
				PORT: '3000',
				NODE_ENV: 'production',
				API_URL: `https://${fullDomain}`,
				REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
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
			desiredCount: isBootstrap ? 0 : config.ecs.desiredCount,
			securityGroups: [frontendSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'frontend',
			circuitBreaker: { enable: true, rollback: true },
			deploymentAlarms: {
				alarmNames: [TARGET_5XX_ALARM_NAME],
				behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
			},
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// ===========================================
		// MCP Service (Fargate)
		// ===========================================
		const mcpLogGroup = new logs.LogGroup(this, 'McpLogGroup', {
			logGroupName: `/ecs/${config.logInfix}mcp`,
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const mcpTaskDefinition = new ecs.FargateTaskDefinition(this, 'McpTaskDef', {
			memoryLimitMiB: config.ecs.memory,
			cpu: config.ecs.cpu,
		});

		mcpTaskDefinition.addContainer('mcp', {
			image: ecs.ContainerImage.fromEcrRepository(mcpRepository, 'init'),
			logging: ecs.LogDrivers.awsLogs({
				logGroup: mcpLogGroup,
				streamPrefix: 'mcp',
			}),
			environment: {
				PORT: '3002',
				NODE_ENV: 'production',
				API_URL: 'http://api.internal:3001',
				DB_HOST: database.instanceEndpoint.hostname,
				DB_PORT: database.instanceEndpoint.port.toString(),
				DB_NAME: 'doc_platform',
				DB_USER: 'postgres',
				ERROR_LOG_GROUP: errorLogGroup.logGroupName,
			},
			secrets: {
				DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, 'password'),
			},
			portMappings: [{ containerPort: 3002 }],
			healthCheck: {
				command: ['CMD-SHELL', 'node -e "fetch(\'http://localhost:3002/mcp/health\').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'],
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
				retries: 3,
				startPeriod: cdk.Duration.seconds(60),
			},
		});

		const mcpService = new ecs.FargateService(this, 'McpService', {
			cluster,
			taskDefinition: mcpTaskDefinition,
			desiredCount: isBootstrap ? 0 : config.ecs.desiredCount,
			securityGroups: [mcpSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'mcp',
			circuitBreaker: { enable: true, rollback: true },
			deploymentAlarms: {
				alarmNames: [TARGET_5XX_ALARM_NAME],
				behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
			},
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// Grant MCP task permission to write to error log group
		errorLogGroup.grantWrite(mcpTaskDefinition.taskRole);

		// ===========================================
		// Storage Service (Fargate) - Internal Only
		// ===========================================
		const storageLogGroup = new logs.LogGroup(this, 'StorageLogGroup', {
			logGroupName: `/ecs/${config.logInfix}storage`,
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const storageTaskDefinition = new ecs.FargateTaskDefinition(this, 'StorageTaskDef', {
			memoryLimitMiB: config.ecs.memory,
			cpu: config.ecs.cpu,
		});

		storageTaskDefinition.addContainer('storage', {
			image: ecs.ContainerImage.fromEcrRepository(storageRepository, 'init'),
			logging: ecs.LogDrivers.awsLogs({
				logGroup: storageLogGroup,
				streamPrefix: 'storage',
			}),
			environment: {
				PORT: '3003',
				NODE_ENV: 'production',
				DB_HOST: storageDatabase.instanceEndpoint.hostname,
				DB_PORT: storageDatabase.instanceEndpoint.port.toString(),
				DB_NAME: 'storagedb',
				DB_USER: 'postgres',
				S3_BUCKET: storageBucket.bucketName,
				S3_REGION: this.region,
			},
			secrets: {
				DB_PASSWORD: ecs.Secret.fromSecretsManager(storageDbCredentials, 'password'),
				STORAGE_API_KEY: ecs.Secret.fromSecretsManager(storageApiKeySecret),
			},
			portMappings: [{ containerPort: 3003 }],
			healthCheck: {
				command: ['CMD-SHELL', 'node -e "fetch(\'http://localhost:3003/health\').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'],
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
				retries: 3,
				startPeriod: cdk.Duration.seconds(60),
			},
		});

		// Grant storage service permission to read/write S3 bucket
		storageBucket.grantReadWrite(storageTaskDefinition.taskRole);

		const storageService = new ecs.FargateService(this, 'StorageService', {
			cluster,
			taskDefinition: storageTaskDefinition,
			desiredCount: isBootstrap ? 0 : config.ecs.desiredCount,
			securityGroups: [storageSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'storage',
			circuitBreaker: { enable: true, rollback: true },
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// ===========================================
		// GitHub Sync Lambda
		// ===========================================
		const syncLambdaSecurityGroup = new ec2.SecurityGroup(this, 'SyncLambdaSecurityGroup', {
			vpc,
			description: 'Security group for GitHub Sync Lambda',
			allowAllOutbound: false,
		});

		syncLambdaSecurityGroup.addEgressRule(
			ec2.Peer.anyIpv4(),
			ec2.Port.tcp(443),
			'Allow HTTPS to GitHub API'
		);
		syncLambdaSecurityGroup.addEgressRule(
			storageSecurityGroup,
			ec2.Port.tcp(3003),
			'Allow Lambda to Storage'
		);
		syncLambdaSecurityGroup.addEgressRule(
			dbSecurityGroup,
			ec2.Port.tcp(5432),
			'Allow Lambda to PostgreSQL'
		);

		storageSecurityGroup.addIngressRule(
			syncLambdaSecurityGroup,
			ec2.Port.tcp(3003),
			'Allow Sync Lambda to Storage'
		);
		dbSecurityGroup.addIngressRule(
			syncLambdaSecurityGroup,
			ec2.Port.tcp(5432),
			'Allow Sync Lambda to PostgreSQL'
		);

		const syncLambdaLogGroup = new logs.LogGroup(this, 'SyncLambdaLogGroup', {
			logGroupName: `/lambda/${config.logInfix}github-sync`,
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const syncLambdaDlq = new sqs.Queue(this, 'SyncLambdaDlq', {
			queueName: `${config.resourcePrefix}-github-sync-dlq`,
			retentionPeriod: cdk.Duration.days(14),
		});

		// SNS topic for operational alarms
		const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
			topicName: `${config.resourcePrefix}-alarms`,
		});

		if (config.alarmEmail) {
			alarmTopic.addSubscription(
				new snsSubscriptions.EmailSubscription(config.alarmEmail)
			);
		}

		// Alarm when messages arrive in DLQ (indicates sync failures)
		const dlqAlarm = new cloudwatch.Alarm(this, 'SyncLambdaDlqAlarm', {
			alarmName: `${config.resourcePrefix}-github-sync-dlq-messages`,
			alarmDescription: 'GitHub sync Lambda failures detected in DLQ',
			metric: syncLambdaDlq.metricApproximateNumberOfMessagesVisible({
				period: cdk.Duration.minutes(1),
				statistic: 'Sum',
			}),
			threshold: 1,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

		const syncLambda = new lambda.Function(this, 'GitHubSyncLambda', {
			functionName: githubSyncLambdaName,
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromAsset(path.join(__dirname, '../../sync-lambda/dist')),
			memorySize: 512,
			timeout: cdk.Duration.minutes(5),
			retryAttempts: 2,
			deadLetterQueue: syncLambdaDlq,
			reservedConcurrentExecutions: 10,
			vpc,
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			securityGroups: [syncLambdaSecurityGroup],
			logGroup: syncLambdaLogGroup,
			environment: {
				NODE_ENV: 'production',
				NODE_OPTIONS: '--enable-source-maps',
				STORAGE_SERVICE_URL: 'http://storage.internal:3003',
				DB_HOST: database.instanceEndpoint.hostname,
				DB_PORT: database.instanceEndpoint.port.toString(),
				DB_NAME: 'doc_platform',
				DB_USER: 'postgres',
			},
		});

		dbCredentials.grantRead(syncLambda);
		storageApiKeySecret.grantRead(syncLambda);
		apiKeyEncryptionSecret.grantRead(syncLambda);

		syncLambda.addEnvironment('DB_PASSWORD_SECRET_ARN', dbCredentials.secretArn);
		syncLambda.addEnvironment('STORAGE_API_KEY_SECRET_ARN', storageApiKeySecret.secretArn);
		syncLambda.addEnvironment('API_KEY_ENCRYPTION_KEY_SECRET_ARN', apiKeyEncryptionSecret.secretArn);

		// Grant API service permission to invoke this Lambda
		syncLambda.grantInvoke(apiTaskDefinition.taskRole);

		// ===========================================
		// CloudMap Service Discovery (Internal DNS)
		// ===========================================
		const internalNamespace = new servicediscovery.PrivateDnsNamespace(this, 'InternalNamespace', {
			name: 'internal',
			vpc,
			description: `Internal service discovery namespace (${config.name})`,
		});

		apiService.enableCloudMap({
			cloudMapNamespace: internalNamespace,
			name: 'api',
			dnsRecordType: servicediscovery.DnsRecordType.A,
			dnsTtl: cdk.Duration.seconds(10),
		});

		storageService.enableCloudMap({
			cloudMapNamespace: internalNamespace,
			name: 'storage',
			dnsRecordType: servicediscovery.DnsRecordType.A,
			dnsTtl: cdk.Duration.seconds(10),
		});

		// ===========================================
		// ALB Target Groups & Routing
		// ===========================================
		const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
			vpc,
			port: 3001,
			protocol: elbv2.ApplicationProtocol.HTTP,
			targetType: elbv2.TargetType.IP,
			deregistrationDelay: cdk.Duration.seconds(30),
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
			deregistrationDelay: cdk.Duration.seconds(30),
			healthCheck: {
				path: '/health',
				interval: cdk.Duration.seconds(30),
				healthyThresholdCount: 2,
				unhealthyThresholdCount: 3,
			},
		});
		frontendService.attachToApplicationTargetGroup(frontendTargetGroup);

		const mcpTargetGroup = new elbv2.ApplicationTargetGroup(this, 'McpTargetGroup', {
			vpc,
			port: 3002,
			protocol: elbv2.ApplicationProtocol.HTTP,
			targetType: elbv2.TargetType.IP,
			deregistrationDelay: cdk.Duration.seconds(30),
			healthCheck: {
				path: '/mcp/health',
				interval: cdk.Duration.seconds(30),
				healthyThresholdCount: 2,
				unhealthyThresholdCount: 3,
			},
		});
		mcpService.attachToApplicationTargetGroup(mcpTargetGroup);

		// Path-based routing: /api/* -> API, /mcp -> MCP, everything else -> Frontend
		httpsListener.addTargetGroups('ApiRoutes', {
			targetGroups: [apiTargetGroup],
			priority: 10,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/api/*']),
			],
		});

		httpsListener.addTargetGroups('OAuthConsentRoute', {
			targetGroups: [frontendTargetGroup],
			priority: 15,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/oauth/consent']),
			],
		});

		httpsListener.addTargetGroups('OAuthRoutes', {
			targetGroups: [apiTargetGroup],
			priority: 20,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/oauth/*']),
			],
		});

		httpsListener.addTargetGroups('WellKnownRoutes', {
			targetGroups: [apiTargetGroup],
			priority: 30,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/.well-known/*']),
			],
		});

		httpsListener.addTargetGroups('McpRoutes', {
			targetGroups: [mcpTargetGroup],
			priority: 40,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/mcp', '/mcp/*']),
			],
		});

		httpsListener.addTargetGroups('DefaultRoute', {
			targetGroups: [frontendTargetGroup],
		});

		// ===========================================
		// CloudWatch Alarms
		// ===========================================
		const apiCpuAlarm = new cloudwatch.Alarm(this, 'ApiCpuAlarm', {
			alarmName: `${config.resourcePrefix}-api-cpu-high`,
			alarmDescription: 'API service CPU utilization exceeds 80%',
			metric: apiService.metricCpuUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});
		apiCpuAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

		const apiMemoryAlarm = new cloudwatch.Alarm(this, 'ApiMemoryAlarm', {
			alarmName: `${config.resourcePrefix}-api-memory-high`,
			alarmDescription: 'API service memory utilization exceeds 80%',
			metric: apiService.metricMemoryUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});
		apiMemoryAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

		const frontendCpuAlarm = new cloudwatch.Alarm(this, 'FrontendCpuAlarm', {
			alarmName: `${config.resourcePrefix}-frontend-cpu-high`,
			alarmDescription: 'Frontend service CPU utilization exceeds 80%',
			metric: frontendService.metricCpuUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});
		frontendCpuAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

		const frontendMemoryAlarm = new cloudwatch.Alarm(this, 'FrontendMemoryAlarm', {
			alarmName: `${config.resourcePrefix}-frontend-memory-high`,
			alarmDescription: 'Frontend service memory utilization exceeds 80%',
			metric: frontendService.metricMemoryUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});
		frontendMemoryAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

		const alb5xxAlarm = new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
			alarmName: `${config.resourcePrefix}-alb-5xx-errors`,
			alarmDescription: 'ALB 5xx errors exceed 10 over two consecutive 5-minute periods',
			metric: alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 10,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});
		alb5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

		// Target 5xx Error Alarm (errors from API/Frontend services)
		// Used by ECS deployment alarms to auto-rollback on sustained errors.
		// evaluationPeriods: 2 avoids false positives during normal rolling updates
		// where brief 502/503s occur during target deregistration.
		const target5xxAlarm = new cloudwatch.Alarm(this, 'Target5xxAlarm', {
			alarmName: TARGET_5XX_ALARM_NAME,
			alarmDescription: 'Target 5xx errors exceed 10 over two consecutive 5-minute periods',
			metric: alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 10,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});
		target5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

		// ECS deployment alarms reference the alarm by NAME (a string), not a
		// CDK token. CDK won't create an automatic dependency, so CloudFormation
		// could try to create the services before the alarm exists. Fix with
		// explicit dependencies.
		apiService.node.addDependency(target5xxAlarm);
		frontendService.node.addDependency(target5xxAlarm);
		mcpService.node.addDependency(target5xxAlarm);

		// ===========================================
		// WAF (production only)
		// ===========================================
		if (config.waf) {
			const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
				defaultAction: { allow: {} },
				scope: 'REGIONAL',
				visibilityConfig: {
					cloudWatchMetricsEnabled: true,
					metricName: `${config.resourcePrefix}-waf`,
					sampledRequestsEnabled: true,
				},
				rules: [
					{
						name: 'AWSManagedRulesCommonRuleSet',
						priority: 1,
						overrideAction: { none: {} },
						statement: {
							managedRuleGroupStatement: {
								vendorName: 'AWS',
								name: 'AWSManagedRulesCommonRuleSet',
								excludedRules: [{ name: 'SizeRestrictions_BODY' }],
							},
						},
						visibilityConfig: {
							cloudWatchMetricsEnabled: true,
							metricName: 'AWSManagedRulesCommonRuleSet',
							sampledRequestsEnabled: true,
						},
					},
					{
						name: 'AWSManagedRulesKnownBadInputsRuleSet',
						priority: 2,
						overrideAction: { none: {} },
						statement: {
							managedRuleGroupStatement: {
								vendorName: 'AWS',
								name: 'AWSManagedRulesKnownBadInputsRuleSet',
							},
						},
						visibilityConfig: {
							cloudWatchMetricsEnabled: true,
							metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
							sampledRequestsEnabled: true,
						},
					},
					{
						name: 'AWSManagedRulesSQLiRuleSet',
						priority: 3,
						overrideAction: { none: {} },
						statement: {
							managedRuleGroupStatement: {
								vendorName: 'AWS',
								name: 'AWSManagedRulesSQLiRuleSet',
							},
						},
						visibilityConfig: {
							cloudWatchMetricsEnabled: true,
							metricName: 'AWSManagedRulesSQLiRuleSet',
							sampledRequestsEnabled: true,
						},
					},
					{
						name: 'AWSManagedRulesAmazonIpReputationList',
						priority: 4,
						overrideAction: { none: {} },
						statement: {
							managedRuleGroupStatement: {
								vendorName: 'AWS',
								name: 'AWSManagedRulesAmazonIpReputationList',
							},
						},
						visibilityConfig: {
							cloudWatchMetricsEnabled: true,
							metricName: 'AWSManagedRulesAmazonIpReputationList',
							sampledRequestsEnabled: true,
						},
					},
					{
						name: 'RateLimitRule',
						priority: 5,
						action: { block: {} },
						statement: {
							rateBasedStatement: {
								limit: 2000,
								aggregateKeyType: 'IP',
							},
						},
						visibilityConfig: {
							cloudWatchMetricsEnabled: true,
							metricName: `${config.resourcePrefix}-rate-limit`,
							sampledRequestsEnabled: true,
						},
					},
				],
			});

			new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
				resourceArn: alb.loadBalancerArn,
				webAclArn: webAcl.attrArn,
			});
		}

		// ===========================================
		// GitHub Actions OIDC & IAM Role
		// ===========================================
		if (config.createSharedResources) {
			// OIDC provider and deploy role are account-level singletons,
			// created by the staging stack and used by all environments.
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
						},
						// StringLike allows multiple OIDC sub claim formats:
						// - ref-based: used when job has no `environment:` key (staging CD, tag-triggered deploys)
						// - environment-based: used when job has `environment:` key (GitHub Environment protection)
						// Note: `environment:` on a job REPLACES the ref in the sub claim (it's either/or, not both)
						StringLike: {
							'token.actions.githubusercontent.com:sub': [
								'repo:kcjonson/doc-platform:ref:refs/heads/main',
								'repo:kcjonson/doc-platform:ref:refs/tags/v*',
								'repo:kcjonson/doc-platform:environment:staging',
								'repo:kcjonson/doc-platform:environment:production',
							],
						},
					},
					'sts:AssumeRoleWithWebIdentity'
				),
				description: 'Role for GitHub Actions to deploy to ECS (all environments)',
				maxSessionDuration: cdk.Duration.hours(2),
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
					(apiRepository as ecr.Repository).repositoryArn,
					(frontendRepository as ecr.Repository).repositoryArn,
					(mcpRepository as ecr.Repository).repositoryArn,
					(storageRepository as ecr.Repository).repositoryArn,
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

			// ECS permissions - scoped to doc-platform clusters for mutations
			// Wildcard covers both staging (doc-platform) and production (doc-platform-prod)
			const serviceArnPattern = `arn:aws:ecs:${this.region}:${this.account}:service/doc-platform*/*`;
			const taskArnPattern = `arn:aws:ecs:${this.region}:${this.account}:task/doc-platform*/*`;
			const taskDefArnPattern = `arn:aws:ecs:${this.region}:${this.account}:task-definition/*:*`;

			deployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['ecs:UpdateService'],
				resources: [serviceArnPattern],
			}));

			deployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['ecs:RunTask', 'ecs:RegisterTaskDefinition'],
				resources: [taskDefArnPattern],
			}));

			deployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['ecs:StopTask'],
				resources: [taskArnPattern],
			}));

			// Pass role to ECS tasks — all 4 services' task and execution roles,
			// plus production stack roles via wildcard
			deployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['iam:PassRole'],
				resources: [
					apiTaskDefinition.taskRole.roleArn,
					apiTaskDefinition.executionRole!.roleArn,
					frontendTaskDefinition.taskRole.roleArn,
					frontendTaskDefinition.executionRole!.roleArn,
					mcpTaskDefinition.taskRole.roleArn,
					mcpTaskDefinition.executionRole!.roleArn,
					storageTaskDefinition.taskRole.roleArn,
					storageTaskDefinition.executionRole!.roleArn,
					// Production stack CDK-generated roles
					`arn:aws:iam::${this.account}:role/DocPlatformProd-*`,
				],
			}));

			// CloudFormation - read stack outputs (all stacks, read-only)
			deployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['cloudformation:DescribeStacks'],
				resources: ['*'],
			}));

			// CDK deployment - assume CDK bootstrap roles
			deployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['sts:AssumeRole'],
				resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
			}));

			// CloudWatch Logs - view logs for all ECS services (both environments)
			deployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: [
					'logs:GetLogEvents',
					'logs:DescribeLogStreams',
				],
				resources: [
					`arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/*`,
					`arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/*:*`,
				],
			}));

			new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
				value: deployRole.roleArn,
				description: 'ARN of IAM role for GitHub Actions deployment',
			});
		}

		// ===========================================
		// Outputs
		// ===========================================
		new cdk.CfnOutput(this, 'AlbDnsName', {
			value: alb.loadBalancerDnsName,
			description: 'Application Load Balancer DNS Name',
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

		new cdk.CfnOutput(this, 'EnvironmentUrl', {
			value: `https://${fullDomain}`,
			description: `${config.name} environment URL`,
		});

		new cdk.CfnOutput(this, 'StorageDatabaseEndpoint', {
			value: storageDatabase.instanceEndpoint.hostname,
			description: 'Storage service RDS PostgreSQL Endpoint',
		});

		new cdk.CfnOutput(this, 'StorageBucketName', {
			value: storageBucket.bucketName,
			description: 'S3 bucket for file content storage',
		});

		new cdk.CfnOutput(this, 'GitHubSyncLambdaArn', {
			value: syncLambda.functionArn,
			description: 'GitHub Sync Lambda ARN',
		});

		// Shared resource outputs (only from the stack that creates them)
		if (config.createSharedResources) {
			new cdk.CfnOutput(this, 'ApiRepositoryUri', {
				value: (apiRepository as ecr.Repository).repositoryUri,
				description: 'ECR Repository URI for API',
			});

			new cdk.CfnOutput(this, 'FrontendRepositoryUri', {
				value: (frontendRepository as ecr.Repository).repositoryUri,
				description: 'ECR Repository URI for Frontend',
			});

			new cdk.CfnOutput(this, 'McpRepositoryUri', {
				value: (mcpRepository as ecr.Repository).repositoryUri,
				description: 'ECR Repository URI for MCP',
			});

			new cdk.CfnOutput(this, 'StorageRepositoryUri', {
				value: (storageRepository as ecr.Repository).repositoryUri,
				description: 'ECR Repository URI for Storage service',
			});

			new cdk.CfnOutput(this, 'HostedZoneId', {
				value: (hostedZone as route53.HostedZone).hostedZoneId,
				description: 'Route53 Hosted Zone ID',
			});

			new cdk.CfnOutput(this, 'HostedZoneNameServers', {
				value: cdk.Fn.join(', ', (hostedZone as route53.HostedZone).hostedZoneNameServers || []),
				description: 'Route53 Nameservers - update these in GoDaddy',
			});

			new cdk.CfnOutput(this, 'CertificateArn', {
				value: certificate.certificateArn,
				description: 'ACM Certificate ARN',
			});
		}
	}
}
