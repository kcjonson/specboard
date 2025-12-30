# COMPLETE - 2025-12-30

# Domain & SSL Setup for staging.specboard.io

## Overview

Add HTTPS support and custom domain to the existing staging infrastructure:
- Route53 hosted zone for `specboard.io`
- Wildcard ACM certificate (`*.specboard.io` + `specboard.io`)
- HTTPS listener on ALB (port 443)
- HTTP→HTTPS redirect
- DNS A record for `staging.specboard.io`

## Files to Modify

- `/Volumes/Code/doc-platform/infra/lib/doc-platform-stack.ts` - Main CDK stack

## Implementation Steps

### 1. Add Imports

```typescript
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
```

### 2. Create Route53 Hosted Zone (after VPC section ~line 44)

```typescript
// ===========================================
// DNS & SSL
// ===========================================
const domainName = 'specboard.io';
const stagingSubdomain = 'staging';
const stagingDomain = `${stagingSubdomain}.${domainName}`;

const hostedZone = new route53.HostedZone(this, 'HostedZone', {
    zoneName: domainName,
    comment: 'Managed by CDK - doc-platform',
});
```

### 3. Create ACM Certificate

```typescript
const certificate = new acm.Certificate(this, 'Certificate', {
    domainName: domainName,
    subjectAlternativeNames: [`*.${domainName}`],
    validation: acm.CertificateValidation.fromDns(hostedZone),
});
```

### 4. Modify ALB Listeners

Replace HTTP listener with HTTPS + redirect:

```typescript
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
```

### 5. Update Listener References

Change all `listener.addTargetGroups()` to `httpsListener.addTargetGroups()`

### 6. Create DNS A Record

```typescript
new route53.ARecord(this, 'StagingARecord', {
    zone: hostedZone,
    recordName: stagingSubdomain,
    target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(alb)
    ),
});
```

### 7. Update API_URL Environment Variables

Change frontend and MCP containers to use the staging domain:
```typescript
API_URL: `https://${stagingDomain}`,
```

### 8. Add Outputs

```typescript
new cdk.CfnOutput(this, 'HostedZoneNameServers', {
    value: cdk.Fn.join(', ', hostedZone.hostedZoneNameServers || []),
    description: 'Route53 Nameservers - update these in GoDaddy',
});

new cdk.CfnOutput(this, 'StagingUrl', {
    value: `https://${stagingDomain}`,
    description: 'Staging environment URL',
});
```

## Manual Steps Required

### During First Deploy

1. Run `cdk deploy` - it will create hosted zone then wait for certificate validation
2. While waiting, go to AWS Console → Route53 → Hosted Zones → specboard.io
3. Copy the 4 NS records (nameservers)
4. Go to GoDaddy → Domain Settings → Nameservers → Change to Custom
5. Enter the 4 AWS nameservers
6. CDK deploy will continue once DNS propagates and certificate validates

### Timing

- DNS propagation: minutes to 48 hours (usually fast)
- Certificate validation: 5-30 minutes after nameservers update
- If CDK times out, just run `cdk deploy` again after nameservers are set

## Verification

After deploy:
- `https://staging.specboard.io` loads the app
- `http://staging.specboard.io` redirects to HTTPS
- ALB DNS name still works as fallback
