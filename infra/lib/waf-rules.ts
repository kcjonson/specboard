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
	/** Rules the group ships with a Block action. */
	readonly blocking: readonly string[];
	/** The subset of `blocking` we downgrade to count. */
	readonly counted: readonly string[];
	/** Rules the group already ships as Count. Listed to keep the tables exhaustive; never overridden. */
	readonly countOnly?: readonly string[];
}

/**
 * The managed rule groups on the production ACL, with every rule they ship listed by name.
 *
 * The dividing line is the field a rule inspects, not the attack it names:
 *
 *   The firewall inspects the envelope. The application validates the payload.
 *
 * URI path, headers, cookies, method, source IP, and size are envelope: nothing a user types
 * lands there, so a signature match is a real signal and those rules block. Request bodies and
 * query arguments are payload, and on a tool for tracking software development they carry prose
 * about code. A signature reading that prose is reading content, not an attack. Someone
 * documenting an XSS bug searches for a script tag, someone describing a migration pastes SQL,
 * someone writing up log4j names the lookup syntax. Each is a legitimate request the payload
 * rules reject, and there are production log records of the last two doing exactly that.
 *
 * What backs the payload half is the application, not the absence of a check: every query in
 * shared/db and api passes user values as $n placeholders (interpolation is confined to column
 * names and placeholder indices), the app has no HTML sink for user content, and the inputs that
 * really are filesystem paths reject '..' in validateSpecInput and normalizePath. WAF body
 * inspection could not be that backstop anyway, since the ALB hands it only the first 8 KB of a
 * body and item descriptions routinely run longer.
 *
 * The lists are exhaustive because an override can only carry the custom block response if it
 * names a rule. That also fails safe: a rule AWS adds later still blocks, it just blocks with
 * the default bare 403 until it is classified here.
 *
 * Refresh a group, including each rule's shipped action, with:
 *   aws wafv2 describe-managed-rule-group --vendor-name AWS --scope REGIONAL \
 *     --region us-west-2 --name <group> --query 'Rules[].{Name:Name,Action:Action}'
 */
export const MANAGED_RULE_GROUPS: readonly ManagedRuleGroup[] = [
	{
		name: 'AWSManagedRulesCommonRuleSet',
		blocking: [
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
			// Payload: item titles, descriptions, notes, and the search box, which is a query argument
			'GenericLFI_BODY',
			'GenericLFI_QUERYARGUMENTS',
			'GenericRFI_BODY',
			'GenericRFI_QUERYARGUMENTS',
			'CrossSiteScripting_BODY',
			'CrossSiteScripting_QUERYARGUMENTS',
			'EC2MetaDataSSRF_BODY',
			'EC2MetaDataSSRF_QUERYARGUMENTS',
			// Editor file endpoints take the file name in ?path=; .log/.ini/.conf are legitimate docs
			'RestrictedExtensions_QUERYARGUMENTS',
			// Bodies are long by design, and the ALB truncates at 8 KB before WAF sees them
			'SizeRestrictions_BODY',
			// MCP clients' OAuth login paths (Codex) send no User-Agent
			'NoUserAgent_HEADER',
		],
	},
	{
		name: 'AWSManagedRulesKnownBadInputsRuleSet',
		blocking: [
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
		counted: [
			// Log4JRCE_BODY blocked the item filed to track this audit, for naming the lookup
			// syntax. There is no JNDI in Node, and no Java anywhere in the stack
			'Log4JRCE_BODY',
			'Log4JRCE_QUERYSTRING',
			'JavaDeserializationRCE_BODY',
			'JavaDeserializationRCE_QUERYSTRING',
			// The app has no HTML sink for user content: the only dangerouslySetInnerHTML is a
			// static constant in NotFound, Preact escapes by default, and the editor renders
			// through Slate components. This is the counted rule with the least direct evidence
			// behind it, never having been observed firing either way
			'ReactJSRCE_BODY',
		],
	},
	{
		name: 'AWSManagedRulesSQLiRuleSet',
		blocking: [
			'SQLiExtendedPatterns_QUERYARGUMENTS',
			'SQLi_QUERYARGUMENTS',
			'SQLi_BODY',
			'SQLi_COOKIE',
			'SQLi_URIPATH',
		],
		counted: [
			// SQLi_BODY terminated two production /mcp writes on 2026-09-08. Descriptions quote
			// queries and migrations, and the search box is where you go looking for them
			'SQLi_BODY',
			'SQLi_QUERYARGUMENTS',
			'SQLiExtendedPatterns_QUERYARGUMENTS',
		],
		// AWS ships these as Count. They stay unoverridden: an override would turn telemetry
		// rules into blocking ones, which is why the shipped action is recorded here at all
		countOnly: [
			'SQLiExtendedPatterns_HEADER_RC_COUNT',
			'SQLiExtendedPatterns_URIPATH_RC_COUNT',
			'SQLiExtendedPatterns_BODY_RC_COUNT',
			'SQLiExtendedPatterns_QUERYARGUMENTS_RC_COUNT',
		],
	},
	{
		name: 'AWSManagedRulesAmazonIpReputationList',
		blocking: [
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
	const unknown = group.counted.filter((name) => !group.blocking.includes(name));
	if (unknown.length > 0) {
		// An override naming a rule the group doesn't ship is accepted and does nothing, so a
		// typo would silently restore blocking on traffic we meant to let through
		throw new Error(`${group.name} counts rules it does not block: ${unknown.join(', ')}`);
	}
	const overridden = (group.countOnly ?? []).filter((name) => group.blocking.includes(name));
	if (overridden.length > 0) {
		throw new Error(`${group.name} lists count-only rules as blocking: ${overridden.join(', ')}`);
	}
	return group.blocking.map((name) => ({
		name,
		actionToUse: group.counted.includes(name) ? COUNT : BLOCK_WITH_RESPONSE,
	}));
}
