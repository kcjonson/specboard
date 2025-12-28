import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class DocPlatformStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

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
		// ECR Repositories
		// ===========================================
		const apiRepository = new ecr.Repository(this, 'ApiRepository', {
			repositoryName: 'doc-platform/api',
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			emptyOnDelete: true,
		});

		const frontendRepository = new ecr.Repository(this, 'FrontendRepository', {
			repositoryName: 'doc-platform/frontend',
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			emptyOnDelete: true,
		});

		const mcpRepository = new ecr.Repository(this, 'McpRepository', {
			repositoryName: 'doc-platform/mcp',
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			emptyOnDelete: true,
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

		const listener = alb.addListener('HttpListener', {
			port: 80,
			open: true,
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
		// API Service (Fargate)
		// ===========================================
		const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
			logGroupName: '/ecs/api',
			retention: logs.RetentionDays.TWO_WEEKS,
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
				REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
				// Database connection built from components
				DB_HOST: database.instanceEndpoint.hostname,
				DB_PORT: database.instanceEndpoint.port.toString(),
				DB_NAME: 'doc_platform',
				DB_USER: 'postgres',
			},
			secrets: {
				DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, 'password'),
			},
			portMappings: [{ containerPort: 3001 }],
		});

		const apiService = new ecs.FargateService(this, 'ApiService', {
			cluster,
			taskDefinition: apiTaskDefinition,
			desiredCount: 1,
			securityGroups: [apiSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'api',
		});

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
				// Frontend calls API through the ALB (same origin)
				API_URL: `http://${alb.loadBalancerDnsName}`,
				REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
			},
			portMappings: [{ containerPort: 3000 }],
		});

		const frontendService = new ecs.FargateService(this, 'FrontendService', {
			cluster,
			taskDefinition: frontendTaskDefinition,
			desiredCount: 1,
			securityGroups: [frontendSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'frontend',
		});

		// ===========================================
		// MCP Service (Fargate)
		// ===========================================
		const mcpLogGroup = new logs.LogGroup(this, 'McpLogGroup', {
			logGroupName: '/ecs/mcp',
			retention: logs.RetentionDays.TWO_WEEKS,
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
				// MCP calls API via internal URL
				API_URL: 'http://api:3001',
			},
			portMappings: [{ containerPort: 3002 }],
		});

		new ecs.FargateService(this, 'McpService', {
			cluster,
			taskDefinition: mcpTaskDefinition,
			desiredCount: 1,
			securityGroups: [mcpSecurityGroup],
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			serviceName: 'mcp',
		});

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
		listener.addTargetGroups('ApiRoutes', {
			targetGroups: [apiTargetGroup],
			priority: 10,
			conditions: [
				elbv2.ListenerCondition.pathPatterns(['/api/*']),
			],
		});

		listener.addTargetGroups('DefaultRoute', {
			targetGroups: [frontendTargetGroup],
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
	}
}
