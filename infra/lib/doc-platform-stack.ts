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
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { EnvironmentConfig, getFullDomain } from './environment-config';

export interface DocPlatformStackProps extends cdk.StackProps {
	config: EnvironmentConfig;
}

export class DocPlatformStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: DocPlatformStackProps) {
		super(scope, id, props);

		const { config } = props;
		const envName = config.name;
		const fullDomain = getFullDomain(config);
		const isStaging = envName === 'staging';

		// Bootstrap mode: deploy with desiredCount=0 so services don't fail when images don't exist
		// Usage: npx cdk deploy --context bootstrap=true
		const isBootstrap = this.node.tryGetContext('bootstrap') === 'true';

		// Image tag: defaults to 'latest' for staging, but production should pass specific SHA
		// Usage: npx cdk deploy --context env=production --context imageTag=abc123
		const imageTag = this.node.tryGetContext('imageTag') || 'latest';

		// ===========================================
		// VPC
		// ===========================================
		const vpc = new ec2.Vpc(this, 'Vpc', {
			maxAzs: 2,
			natGateways: 1, // Cost optimization: 1 NAT gateway
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
		// DNS & SSL (Shared - only staging creates, production imports)
		// ===========================================
		let hostedZone: route53.IHostedZone;
		let certificate: acm.ICertificate;

		if (isStaging) {
			// Staging creates the hosted zone and certificate
			const createdHostedZone = new route53.HostedZone(this, 'HostedZone', {
				zoneName: config.domain,
				comment: 'Managed by CDK - doc-platform',
			});
			hostedZone = createdHostedZone;

			const createdCertificate = new acm.Certificate(this, 'Certificate', {
				domainName: config.domain,
				subjectAlternativeNames: [`*.${config.domain}`],
				validation: acm.CertificateValidation.fromDns(createdHostedZone),
			});
			certificate = createdCertificate;

			// Retain certificate even if stack is deleted (production depends on it)
			createdCertificate.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

			// Output nameservers for staging stack
			new cdk.CfnOutput(this, 'HostedZoneNameServers', {
				value: cdk.Fn.join(', ', createdHostedZone.hostedZoneNameServers || []),
				description: 'Route53 Nameservers - update these in GoDaddy',
			});
		} else {
			// Production imports the hosted zone and certificate from staging
			hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
				domainName: config.domain,
			});
			// Import certificate by looking it up (or we could pass ARN as context)
			certificate = acm.Certificate.fromCertificateArn(
				this,
				'Certificate',
				cdk.Fn.importValue('DocPlatformStagingCertificateArn')
			);
		}

		// ===========================================
		// ECR Repositories (Shared - staging creates, production imports)
		// ===========================================
		let apiRepository: ecr.IRepository;
		let frontendRepository: ecr.IRepository;
		let mcpRepository: ecr.IRepository;

		if (isStaging) {
			// ECR repos use RETAIN so they survive failed deployments
			const ecrLifecycleRules: ecr.LifecycleRule[] = [
				{
					description: `Keep last ${config.ecrMaxImageCount} images for rollback`,
					maxImageCount: config.ecrMaxImageCount,
					rulePriority: 1,
					tagStatus: ecr.TagStatus.ANY,
				},
			];

			apiRepository = new ecr.Repository(this, 'ApiRepository', {
				repositoryName: 'doc-platform/api',
				removalPolicy: cdk.RemovalPolicy.RETAIN,
				lifecycleRules: ecrLifecycleRules,
			});

			frontendRepository = new ecr.Repository(this, 'FrontendRepository', {
				repositoryName: 'doc-platform/frontend',
				removalPolicy: cdk.RemovalPolicy.RETAIN,
				lifecycleRules: ecrLifecycleRules,
			});

			mcpRepository = new ecr.Repository(this, 'McpRepository', {
				repositoryName: 'doc-platform/mcp',
				removalPolicy: cdk.RemovalPolicy.RETAIN,
				lifecycleRules: ecrLifecycleRules,
			});
		} else {
			// Production imports ECR repos by name (they're shared)
			apiRepository = ecr.Repository.fromRepositoryName(this, 'ApiRepository', 'doc-platform/api');
			frontendRepository = ecr.Repository.fromRepositoryName(this, 'FrontendRepository', 'doc-platform/frontend');
			mcpRepository = ecr.Repository.fromRepositoryName(this, 'McpRepository', 'doc-platform/mcp');
		}

		// ===========================================
		// Secrets (Per-environment)
		// ===========================================
		const secretsPrefix = `${envName}/doc-platform`;

		const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
			secretName: `${secretsPrefix}/db-credentials`,
			generateSecretString: {
				secretStringTemplate: JSON.stringify({ username: 'postgres' }),
				generateStringKey: 'password',
				excludePunctuation: true,
				passwordLength: 32,
			},
		});

		const inviteKeysSecret = new secretsmanager.Secret(this, 'InviteKeys', {
			secretName: `${secretsPrefix}/invite-keys`,
			description: 'Comma-separated list of valid invite keys for signup',
		});

		// ===========================================
		// RDS PostgreSQL (Per-environment)
		// ===========================================
		const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
			vpc,
			description: `Security group for RDS PostgreSQL (${envName})`,
			allowAllOutbound: false,
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
			deletionProtection: config.database.deletionProtection,
			removalPolicy: config.database.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
			backupRetention: cdk.Duration.days(config.database.backupRetentionDays),
			storageEncrypted: true,
		});

		// ===========================================
		// ElastiCache Redis (Per-environment)
		// ===========================================
		const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
			vpc,
			description: `Security group for ElastiCache Redis (${envName})`,
			allowAllOutbound: false,
		});

		const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
			description: `Subnet group for Redis (${envName})`,
			subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
			cacheSubnetGroupName: `doc-platform-redis-${envName}`,
		});

		const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
			cacheNodeType: 'cache.t4g.micro',
			engine: 'redis',
			numCacheNodes: 1,
			vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
			cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
			clusterName: `doc-platform-${envName}`,
		});
		redis.addDependency(redisSubnetGroup);

		// ===========================================
		// ECS Cluster (Per-environment)
		// ===========================================
		const cluster = new ecs.Cluster(this, 'Cluster', {
			vpc,
			clusterName: `doc-platform-${envName}`,
			containerInsights: true,
		});

		// ===========================================
		// Application Load Balancer (Per-environment)
		// ===========================================
		const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
			vpc,
			internetFacing: true,
			loadBalancerName: `doc-platform-${envName}`,
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

		// DNS A Record - staging uses subdomain, production uses apex
		if (config.subdomain) {
			new route53.ARecord(this, 'DnsRecord', {
				zone: hostedZone,
				recordName: config.subdomain,
				target: route53.RecordTarget.fromAlias(
					new route53Targets.LoadBalancerTarget(alb)
				),
				comment: `${envName} environment ALB`,
			});
		} else {
			// Apex domain for production
			new route53.ARecord(this, 'DnsRecord', {
				zone: hostedZone,
				target: route53.RecordTarget.fromAlias(
					new route53Targets.LoadBalancerTarget(alb)
				),
				comment: `${envName} environment ALB (apex)`,
			});
		}

		// ===========================================
		// WAF (Production only)
		// ===========================================
		if (!isStaging) {
			const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
				name: `doc-platform-${envName}-waf`,
				scope: 'REGIONAL',
				defaultAction: { allow: {} },
				visibilityConfig: {
					cloudWatchMetricsEnabled: true,
					metricName: `doc-platform-${envName}-waf`,
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
						name: 'RateLimitRule',
						priority: 4,
						action: { block: {} },
						statement: {
							rateBasedStatement: {
								limit: 2000,
								aggregateKeyType: 'IP',
							},
						},
						visibilityConfig: {
							cloudWatchMetricsEnabled: true,
							metricName: 'RateLimitRule',
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
		// Security Groups for ECS Services
		// ===========================================
		const apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
			vpc,
			description: `Security group for API service (${envName})`,
			allowAllOutbound: true,
		});

		const frontendSecurityGroup = new ec2.SecurityGroup(this, 'FrontendSecurityGroup', {
			vpc,
			description: `Security group for Frontend service (${envName})`,
			allowAllOutbound: true,
		});

		const mcpSecurityGroup = new ec2.SecurityGroup(this, 'McpSecurityGroup', {
			vpc,
			description: `Security group for MCP service (${envName})`,
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
		const errorLogGroupName = `/doc-platform/${envName}/errors`;
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
			logGroupName: `/ecs/${envName}/api`,
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const apiTaskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
			memoryLimitMiB: config.ecs.memory,
			cpu: config.ecs.cpu,
		});

		const apiEnvironment: Record<string, string> = {
			PORT: '3001',
			NODE_ENV: 'production',
			APP_ENV: envName,
			REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
			DB_HOST: database.instanceEndpoint.hostname,
			DB_PORT: database.instanceEndpoint.port.toString(),
			DB_NAME: 'doc_platform',
			DB_USER: 'postgres',
			ERROR_LOG_GROUP: errorLogGroup.logGroupName,
			SES_REGION: 'us-west-2',
			EMAIL_FROM: `noreply@${config.domain}`,
			APP_URL: `https://${fullDomain}`,
		};

		// Only set email allowlist in staging
		if (config.emailAllowlist) {
			apiEnvironment.EMAIL_ALLOWLIST = config.emailAllowlist;
		}

		apiTaskDefinition.addContainer('api', {
			image: ecs.ContainerImage.fromEcrRepository(apiRepository, imageTag),
			logging: ecs.LogDrivers.awsLogs({
				logGroup: apiLogGroup,
				streamPrefix: 'api',
			}),
			environment: apiEnvironment,
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
			desiredCount: isBootstrap ? 0 : config.ecs.desiredCount,
			securityGroups: [apiSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'api',
			circuitBreaker: { enable: true, rollback: true },
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		errorLogGroup.grantWrite(apiTaskDefinition.taskRole);

		// Grant API task permission to send emails via SES
		const sesIdentityArn = cdk.Arn.format({
			service: 'ses',
			resource: 'identity',
			resourceName: config.domain,
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
			memoryLimitMiB: config.ecs.memory,
			cpu: config.ecs.cpu,
		});

		frontendTaskDefinition.addContainer('frontend', {
			image: ecs.ContainerImage.fromEcrRepository(frontendRepository, imageTag),
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
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

		// ===========================================
		// MCP Service (Fargate)
		// ===========================================
		const mcpLogGroup = new logs.LogGroup(this, 'McpLogGroup', {
			logGroupName: `/ecs/${envName}/mcp`,
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const mcpTaskDefinition = new ecs.FargateTaskDefinition(this, 'McpTaskDef', {
			memoryLimitMiB: config.ecs.memory,
			cpu: config.ecs.cpu,
		});

		mcpTaskDefinition.addContainer('mcp', {
			image: ecs.ContainerImage.fromEcrRepository(mcpRepository, imageTag),
			logging: ecs.LogDrivers.awsLogs({
				logGroup: mcpLogGroup,
				streamPrefix: 'mcp',
			}),
			environment: {
				PORT: '3002',
				NODE_ENV: 'production',
				API_URL: `https://${fullDomain}`,
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
			desiredCount: isBootstrap ? 0 : config.ecs.desiredCount,
			securityGroups: [mcpSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'mcp',
			circuitBreaker: { enable: true, rollback: true },
			minHealthyPercent: 50,
			maxHealthyPercent: 200,
			healthCheckGracePeriod: cdk.Duration.seconds(60),
		});

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
		new cloudwatch.Alarm(this, 'ApiCpuAlarm', {
			alarmName: `doc-platform-${envName}-api-cpu-high`,
			alarmDescription: `API service CPU utilization exceeds 80% (${envName})`,
			metric: apiService.metricCpuUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		new cloudwatch.Alarm(this, 'ApiMemoryAlarm', {
			alarmName: `doc-platform-${envName}-api-memory-high`,
			alarmDescription: `API service memory utilization exceeds 80% (${envName})`,
			metric: apiService.metricMemoryUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		new cloudwatch.Alarm(this, 'FrontendCpuAlarm', {
			alarmName: `doc-platform-${envName}-frontend-cpu-high`,
			alarmDescription: `Frontend service CPU utilization exceeds 80% (${envName})`,
			metric: frontendService.metricCpuUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		new cloudwatch.Alarm(this, 'FrontendMemoryAlarm', {
			alarmName: `doc-platform-${envName}-frontend-memory-high`,
			alarmDescription: `Frontend service memory utilization exceeds 80% (${envName})`,
			metric: frontendService.metricMemoryUtilization({
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
			alarmName: `doc-platform-${envName}-alb-5xx-errors`,
			alarmDescription: `ALB 5xx errors exceed 10 in 5 minutes (${envName})`,
			metric: alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 10,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		new cloudwatch.Alarm(this, 'Target5xxAlarm', {
			alarmName: `doc-platform-${envName}-target-5xx-errors`,
			alarmDescription: `Target 5xx errors exceed 10 in 5 minutes (${envName})`,
			metric: alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 10,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});

		// ===========================================
		// GitHub Actions OIDC & IAM Role (Shared - only staging creates)
		// ===========================================
		if (isStaging) {
			const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
				url: 'https://token.actions.githubusercontent.com',
				clientIds: ['sts.amazonaws.com'],
				thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
			});

			// Retain OIDC provider even if stack is deleted (both environments depend on it)
			// Note: OpenIdConnectProvider doesn't support removal policy directly, but it's
			// safe because AWS won't delete OIDC providers that have role trust relationships

			// Role for staging deployments (main branch only)
			const stagingDeployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
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
				description: 'Role for GitHub Actions to deploy to staging',
			});

			this.addDeployRolePermissions(stagingDeployRole, apiRepository, frontendRepository, mcpRepository, cluster, apiTaskDefinition, apiLogGroup);

			// Role for production deployments (release tags)
			const productionDeployRole = new iam.Role(this, 'GitHubActionsProductionDeployRole', {
				roleName: 'doc-platform-github-actions-deploy-production',
				assumedBy: new iam.FederatedPrincipal(
					githubOidcProvider.openIdConnectProviderArn,
					{
						StringLike: {
							'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
							'token.actions.githubusercontent.com:sub': 'repo:kcjonson/doc-platform:ref:refs/tags/v*',
						},
					},
					'sts:AssumeRoleWithWebIdentity'
				),
				description: 'Role for GitHub Actions to deploy to production via releases',
			});

			this.addDeployRolePermissions(productionDeployRole, apiRepository, frontendRepository, mcpRepository, cluster, apiTaskDefinition, apiLogGroup);

			// Production role needs access to production cluster too
			const productionClusterArn = `arn:aws:ecs:${this.region}:${this.account}:cluster/doc-platform-production`;
			const productionServiceArn = `arn:aws:ecs:${this.region}:${this.account}:service/doc-platform-production/*`;
			const productionTaskArn = `arn:aws:ecs:${this.region}:${this.account}:task/doc-platform-production/*`;

			productionDeployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['ecs:UpdateService'],
				resources: [productionServiceArn],
			}));

			productionDeployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['ecs:RunTask'],
				resources: [`arn:aws:ecs:${this.region}:${this.account}:task-definition/*`],
			}));

			productionDeployRole.addToPolicy(new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ['ecs:StopTask'],
				resources: [productionTaskArn],
			}));

			// Output role ARNs
			new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
				value: stagingDeployRole.roleArn,
				description: 'ARN of IAM role for GitHub Actions staging deployment',
			});

			new cdk.CfnOutput(this, 'GitHubActionsProductionRoleArn', {
				value: productionDeployRole.roleArn,
				description: 'ARN of IAM role for GitHub Actions production deployment',
				exportName: 'DocPlatformProductionDeployRoleArn',
			});
		}

		// ===========================================
		// Outputs
		// ===========================================
		new cdk.CfnOutput(this, 'AlbDnsName', {
			value: alb.loadBalancerDnsName,
			description: `Application Load Balancer DNS Name (${envName})`,
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
			description: `ECS Cluster Name (${envName})`,
		});

		new cdk.CfnOutput(this, 'DatabaseEndpoint', {
			value: database.instanceEndpoint.hostname,
			description: `RDS PostgreSQL Endpoint (${envName})`,
		});

		new cdk.CfnOutput(this, 'RedisEndpoint', {
			value: redis.attrRedisEndpointAddress,
			description: `ElastiCache Redis Endpoint (${envName})`,
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

		if (isStaging) {
			new cdk.CfnOutput(this, 'CertificateArn', {
				value: certificate.certificateArn,
				description: 'ACM Certificate ARN',
				exportName: 'DocPlatformStagingCertificateArn',
			});
		}

		new cdk.CfnOutput(this, 'EnvironmentUrl', {
			value: `https://${fullDomain}`,
			description: `${envName} environment URL`,
		});
	}

	private addDeployRolePermissions(
		role: iam.Role,
		apiRepository: ecr.IRepository,
		frontendRepository: ecr.IRepository,
		mcpRepository: ecr.IRepository,
		cluster: ecs.ICluster,
		apiTaskDefinition: ecs.FargateTaskDefinition,
		apiLogGroup: logs.ILogGroup
	): void {
		// ECR permissions - GetAuthorizationToken requires * resource
		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecr:GetAuthorizationToken'],
			resources: ['*'],
		}));

		// ECR permissions - push images and describe for verification
		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: [
				'ecr:BatchCheckLayerAvailability',
				'ecr:GetDownloadUrlForLayer',
				'ecr:BatchGetImage',
				'ecr:PutImage',
				'ecr:InitiateLayerUpload',
				'ecr:UploadLayerPart',
				'ecr:CompleteLayerUpload',
				'ecr:DescribeImages',
			],
			resources: [
				apiRepository.repositoryArn,
				frontendRepository.repositoryArn,
				mcpRepository.repositoryArn,
			],
		}));

		// ECS permissions - describe operations need * for waiters
		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: [
				'ecs:DescribeServices',
				'ecs:DescribeTasks',
				'ecs:DescribeTaskDefinition',
				'ecs:ListTasks',
			],
			resources: ['*'],
		}));

		// ECS permissions - scoped to cluster for mutations
		const serviceArnPattern = `arn:aws:ecs:${this.region}:${this.account}:service/${cluster.clusterName}/*`;
		const taskArnPattern = `arn:aws:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`;
		const taskDefArnPattern = `arn:aws:ecs:${this.region}:${this.account}:task-definition/*`;

		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecs:UpdateService'],
			resources: [serviceArnPattern],
		}));

		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecs:RunTask'],
			resources: [taskDefArnPattern],
		}));

		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['ecs:StopTask'],
			resources: [taskArnPattern],
		}));

		// Pass role to ECS tasks
		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['iam:PassRole'],
			resources: [
				apiTaskDefinition.taskRole.roleArn,
				apiTaskDefinition.executionRole!.roleArn,
				// Allow passing production task roles (explicit patterns for security)
				`arn:aws:iam::${this.account}:role/DocPlatform-production-*TaskDef*Role*`,
			],
		}));

		// CloudFormation - read stack outputs
		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['cloudformation:DescribeStacks'],
			resources: ['*'],
		}));

		// CDK deployment - assume CDK bootstrap roles
		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: ['sts:AssumeRole'],
			resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
		}));

		// CloudWatch Logs - for viewing migration logs
		role.addToPolicy(new iam.PolicyStatement({
			effect: iam.Effect.ALLOW,
			actions: [
				'logs:GetLogEvents',
				'logs:DescribeLogStreams',
			],
			resources: [apiLogGroup.logGroupArn, `${apiLogGroup.logGroupArn}:*`],
		}));
	}
}
