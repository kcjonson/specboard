import * as ec2 from 'aws-cdk-lib/aws-ec2';

/**
 * Shared resources that exist once per account, created by the staging stack.
 * Production references these by name/ARN instead of CDK cross-stack exports.
 */
export interface SharedResourceConfig {
	/** ECR repository names (deterministic, same across environments) */
	ecrRepoNames: {
		api: string;
		frontend: string;
		mcp: string;
		storage: string;
	};
	/** Route53 hosted zone ID (from staging stack output) */
	hostedZoneId: string;
	/** Route53 zone name */
	hostedZoneName: string;
	/** ACM certificate ARN (wildcard cert from staging stack output) */
	certificateArn: string;
}

export interface EnvironmentConfig {
	/** Environment identifier */
	name: 'staging' | 'production';

	/** CloudFormation stack name */
	stackName: string;

	/** Base domain */
	domain: string;

	/** Subdomain for this environment (undefined = apex domain) */
	subdomain?: string;

	/**
	 * Whether this stack creates shared resources (ECR repos, Route53 zone,
	 * ACM certificate, OIDC provider, deploy role). Only one stack should
	 * create these — currently staging.
	 */
	createSharedResources: boolean;

	/**
	 * References to shared resources (required when createSharedResources is false).
	 * These values come from the staging stack's CloudFormation outputs.
	 */
	shared?: SharedResourceConfig;

	/** Prefix for named AWS resources (ALB, cluster, Lambda, SQS, SNS, etc.) */
	resourcePrefix: string;

	/** Prefix for Secrets Manager secret names (e.g., 'doc-platform' or 'production/doc-platform') */
	secretsPrefix: string;

	/** Infix inserted into log group paths (e.g., '' for staging, 'production/' for production) */
	logInfix: string;

	/** Database configuration */
	database: {
		instanceClass: ec2.InstanceClass;
		instanceSize: ec2.InstanceSize;
		multiAz: boolean;
		backupRetentionDays: number;
		storageEncrypted: boolean;
		deletionProtection: boolean;
	};

	/** ECS service configuration */
	ecs: {
		desiredCount: number;
		cpu: number;
		memory: number;
	};

	/** NAT gateway count (1 for cost savings, 2 for HA) */
	natGateways: number;

	/** Redis node type */
	redisNodeType: string;

	/** Enable WAF on ALB */
	waf: boolean;

	/** Email address for alarm notifications (optional) */
	alarmEmail?: string;
}

/** Compute the full domain for an environment */
export function getFullDomain(config: EnvironmentConfig): string {
	return config.subdomain
		? `${config.subdomain}.${config.domain}`
		: config.domain;
}

// ECR repo names are deterministic and shared across environments
const ECR_REPO_NAMES = {
	api: 'doc-platform/api',
	frontend: 'doc-platform/frontend',
	mcp: 'doc-platform/mcp',
	storage: 'doc-platform/storage',
};

/**
 * Staging environment configuration.
 * Resource names match existing deployment for backward compatibility.
 */
export const stagingConfig: EnvironmentConfig = {
	name: 'staging',
	stackName: 'DocPlatformStack',
	domain: 'specboard.io',
	subdomain: 'staging',
	createSharedResources: true,
	resourcePrefix: 'doc-platform',
	secretsPrefix: 'doc-platform',
	logInfix: '',
	database: {
		instanceClass: ec2.InstanceClass.T4G,
		instanceSize: ec2.InstanceSize.MICRO,
		multiAz: false,
		backupRetentionDays: 1,
		// Encryption disabled for backward compatibility with existing unencrypted instance.
		// Enable after staging rebuild (requires instance replacement).
		storageEncrypted: false,
		deletionProtection: false,
	},
	ecs: {
		desiredCount: 1,
		cpu: 256,
		memory: 512,
	},
	natGateways: 1,
	redisNodeType: 'cache.t4g.micro',
	waf: false,
};

/**
 * Production environment configuration.
 * Shared resources (ECR, Route53, ACM, OIDC) are imported from the staging stack.
 * The `shared` field must be populated with values from staging stack outputs
 * before the first production deploy.
 */
export const productionConfig: EnvironmentConfig = {
	name: 'production',
	stackName: 'DocPlatformProd',
	domain: 'specboard.io',
	subdomain: undefined,
	createSharedResources: false,
	shared: {
		ecrRepoNames: ECR_REPO_NAMES,
		hostedZoneId: '', // Set from staging stack output before first deploy
		hostedZoneName: 'specboard.io',
		certificateArn: '', // Set from staging stack output before first deploy
	},
	resourcePrefix: 'doc-platform-prod',
	secretsPrefix: 'production/doc-platform',
	logInfix: 'production/',
	database: {
		instanceClass: ec2.InstanceClass.T4G,
		instanceSize: ec2.InstanceSize.MEDIUM,
		multiAz: true,
		backupRetentionDays: 14,
		storageEncrypted: true,
		deletionProtection: true,
	},
	ecs: {
		desiredCount: 2,
		cpu: 256,
		memory: 512,
	},
	natGateways: 2,
	redisNodeType: 'cache.t4g.micro',
	waf: true,
	alarmEmail: '', // Set before first deploy
};

/** Resolve environment config from CDK context. Returns a fresh copy — never mutates the exported defaults. */
export function getEnvironmentConfig(envName: string, context?: {
	hostedZoneId?: string;
	certificateArn?: string;
	alarmEmail?: string;
}): EnvironmentConfig {
	const defaults: Record<string, EnvironmentConfig> = {
		staging: stagingConfig,
		production: productionConfig,
	};

	const base = defaults[envName];
	if (!base) {
		throw new Error(`Unknown environment: ${envName}. Must be 'staging' or 'production'.`);
	}

	// Deep clone to avoid mutating the exported singletons
	const config: EnvironmentConfig = {
		...base,
		database: { ...base.database },
		ecs: { ...base.ecs },
		shared: base.shared ? { ...base.shared, ecrRepoNames: { ...base.shared.ecrRepoNames } } : undefined,
	};

	// Apply context overrides for production shared resources
	if (config.name === 'production' && config.shared) {
		if (context?.hostedZoneId) {
			config.shared.hostedZoneId = context.hostedZoneId;
		}
		if (context?.certificateArn) {
			config.shared.certificateArn = context.certificateArn;
		}
		if (!config.shared.hostedZoneId || !config.shared.certificateArn) {
			throw new Error(
				'Production environment requires --context hostedZoneId=<id> and --context certificateArn=<arn>. ' +
				'Get these from staging stack outputs: HostedZoneId and CertificateArn.'
			);
		}
	}

	if (context?.alarmEmail) {
		config.alarmEmail = context.alarmEmail;
	}

	return config;
}
