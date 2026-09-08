import type * as wafv2 from 'aws-cdk-lib/aws-wafv2';

/** Key of the custom response body registered on the web ACL. */
export const WAF_BLOCK_RESPONSE_KEY = 'wafBlocked';

/**
 * A WAF block answers 403 with an HTML page by default, and on an authenticated request both
 * MCP clients and the browser read a 403 as a credential problem. Claude Code surfaces it as
 * "this connector requires additional permissions", which sends the caller off to reconnect
 * something that was never broken and cannot be fixed that way. Answer 400 with a body that
 * names the firewall, so a rule match is distinguishable from an authorization failure.
 */
export const WAF_BLOCK_RESPONSE_BODY = JSON.stringify({
	error: 'Blocked by the web application firewall',
	code: 'waf_blocked',
	message: 'A security rule matched the contents of this request. This is not an authentication or authorization failure, and reconnecting or re-authorizing will not change the outcome.',
});

/** Key of the custom response body for the rate-limit rule. */
export const WAF_RATE_LIMIT_RESPONSE_KEY = 'wafRateLimited';

/** Same reasoning as the block response: 429 and a named cause beat a bare 403. */
export const WAF_RATE_LIMIT_RESPONSE_BODY = JSON.stringify({
	error: 'Rate limit exceeded',
	code: 'waf_rate_limited',
	message: 'Too many requests from this address. This is not an authentication or authorization failure.',
});

const BLOCK_WITH_RESPONSE: wafv2.CfnWebACL.RuleActionProperty = {
	block: {
		customResponse: {
			responseCode: 400,
			customResponseBodyKey: WAF_BLOCK_RESPONSE_KEY,
		},
	},
};

const COUNT: wafv2.CfnWebACL.RuleActionProperty = { count: {} };

interface ManagedRuleGroup {
	readonly name: string;
	/** Every rule the group ships. */
	readonly rules: readonly string[];
	/** Rules downgraded to count because the signature matches legitimate traffic. */
	readonly counted: readonly string[];
}

/**
 * The managed rule groups on the production ACL, with every rule they ship listed by name.
 *
 * The lists are exhaustive on purpose. An override can only carry the custom block response if
 * it names a rule, so anything missing here keeps the group's default bare 403 — which is the
 * failure mode that made this bug undiagnosable. Enumerating also fails safe: a rule AWS adds
 * later still blocks, it just blocks with the unhelpful response until it is added here.
 *
 * Refresh the lists with:
 *   aws wafv2 describe-managed-rule-group --vendor-name AWS --scope REGIONAL \
 *     --region us-west-2 --name <group> --query 'Rules[].Name'
 */
export const MANAGED_RULE_GROUPS: readonly ManagedRuleGroup[] = [
	{
		name: 'AWSManagedRulesCommonRuleSet',
		rules: [
			'NoUserAgent_HEADER',
			'UserAgent_BadBots_HEADER',
			'SizeRestrictions_QUERYSTRING',
			'SizeRestrictions_Cookie_HEADER',
			'SizeRestrictions_BODY',
			'SizeRestrictions_URIPATH',
			'EC2MetaDataSSRF_BODY',
			'EC2MetaDataSSRF_COOKIE',
			'EC2MetaDataSSRF_URIPATH',
			'EC2MetaDataSSRF_QUERYARGUMENTS',
			'GenericLFI_QUERYARGUMENTS',
			'GenericLFI_URIPATH',
			'GenericLFI_BODY',
			'RestrictedExtensions_URIPATH',
			'RestrictedExtensions_QUERYARGUMENTS',
			'GenericRFI_QUERYARGUMENTS',
			'GenericRFI_BODY',
			'GenericRFI_URIPATH',
			'CrossSiteScripting_COOKIE',
			'CrossSiteScripting_QUERYARGUMENTS',
			'CrossSiteScripting_BODY',
			'CrossSiteScripting_URIPATH',
		],
		counted: [
			// Item descriptions run long, and the ALB only hands WAF the first 8 KB regardless
			'SizeRestrictions_BODY',
			// Specs and comments quote markup; the API stores request bodies, it never renders them
			'CrossSiteScripting_BODY',
			'EC2MetaDataSSRF_BODY',
			'EC2MetaDataSSRF_QUERYARGUMENTS',
			// MCP clients' OAuth login paths (Codex) send no User-Agent
			'NoUserAgent_HEADER',
			// Editor file endpoints take the file name in ?path=; .log/.ini/.conf are legitimate docs
			'RestrictedExtensions_QUERYARGUMENTS',
			// Path traversal in a request body is a URL signature applied to free text. Specboard
			// tracks software, so a relative import or a pasted file path in a title, description,
			// or note is ordinary content, and none of it reaches a filesystem. Path inputs that do
			// (spec links, storage file operations) reject '..' in the handlers instead.
			'GenericLFI_BODY',
		],
	},
	{
		name: 'AWSManagedRulesKnownBadInputsRuleSet',
		rules: [
			'JavaDeserializationRCE_BODY',
			'JavaDeserializationRCE_URIPATH',
			'JavaDeserializationRCE_QUERYSTRING',
			'JavaDeserializationRCE_HEADER',
			'Host_localhost_HEADER',
			'PROPFIND_METHOD',
			'ExploitablePaths_URIPATH',
			'Log4JRCE_QUERYSTRING',
			'Log4JRCE_BODY',
			'Log4JRCE_URIPATH',
			'Log4JRCE_HEADER',
			'ReactJSRCE_BODY',
		],
		counted: [],
	},
	{
		name: 'AWSManagedRulesSQLiRuleSet',
		rules: [
			'SQLiExtendedPatterns_HEADER_RC_COUNT',
			'SQLiExtendedPatterns_URIPATH_RC_COUNT',
			'SQLiExtendedPatterns_BODY_RC_COUNT',
			'SQLiExtendedPatterns_QUERYARGUMENTS_RC_COUNT',
			'SQLiExtendedPatterns_QUERYARGUMENTS',
			'SQLi_QUERYARGUMENTS',
			'SQLi_BODY',
			'SQLi_COOKIE',
			'SQLi_URIPATH',
		],
		counted: [],
	},
	{
		name: 'AWSManagedRulesAmazonIpReputationList',
		rules: [
			'AWSManagedIPReputationList',
			'AWSManagedReconnaissanceList',
			'AWSManagedIPDDoSList',
		],
		counted: [],
	},
];

/** Build a group's per-rule overrides: counted rules pass, everything else blocks with the response. */
export function managedRuleActionOverrides(
	group: ManagedRuleGroup
): wafv2.CfnWebACL.RuleActionOverrideProperty[] {
	const unknown = group.counted.filter((name) => !group.rules.includes(name));
	if (unknown.length > 0) {
		// An override naming a rule the group doesn't ship is accepted and does nothing, so a
		// typo would silently restore blocking on traffic we meant to let through
		throw new Error(`${group.name} counts rules it does not contain: ${unknown.join(', ')}`);
	}
	return group.rules.map((name) => ({
		name,
		actionToUse: group.counted.includes(name) ? COUNT : BLOCK_WITH_RESPONSE,
	}));
}
