/**
 * Setup guide page content component
 */
import type { JSX } from 'preact';
import { BrandLogo } from '../components/logo';

const pluginInstall = `/plugin marketplace add https://specboard.io/claude
/plugin install specboard@specboard`;

const mcpJson = `{
	"mcpServers": {
		"specboard": {
			"type": "http",
			"url": "https://specboard.io/mcp",
			"headers": { "X-Specboard-Project": "<project-slug>" }
		}
	}
}`;

const startupScript = `claude plugin marketplace add https://specboard.io/claude
claude plugin install specboard@specboard --scope user`;

export function SetupContent(): JSX.Element {
	return (
		<div class="setup-container">
			<div class="auth-brand">
				<BrandLogo size={40} href="/" />
			</div>

			<h1>Setup</h1>
			<p class="setup-intro">
				Specboard exposes your planning board to AI assistants over MCP at{' '}
				<code>https://specboard.io/mcp</code>. The same server works everywhere Claude
				runs; how you connect depends on the surface.
			</p>

			<h2>Claude Code</h2>
			<p>
				In a terminal, the desktop app, or an IDE extension, install the Specboard
				plugin from inside a session:
			</p>
			<pre><code>{pluginInstall}</code></pre>
			<p>
				This registers the MCP server and installs two skills:{' '}
				<code>/specboard:whats-next</code> discovers work, scopes it, and keeps board
				status accurate; <code>/specboard:complete</code> verifies finished work,
				finalizes the PR, and closes the item out. On first connect, an OAuth flow
				opens in your browser to authenticate.
			</p>

			<h3>Bind a repo to a project (optional)</h3>
			<p>
				To make every session in a repo target one Specboard project automatically,
				commit a project-scoped <code>.mcp.json</code> at the repo root carrying that
				project's slug, the same identifier you see in its Specboard URL
				(<code>/projects/&lt;slug&gt;/planning</code>):
			</p>
			<pre><code>{mcpJson}</code></pre>
			<p>
				This entry overrides the plugin's server in that repo, so expect a one-time
				sign-in and trust prompt the first time it connects. The slug is a shared
				reference, not a credential; each user still authenticates individually, and
				access is checked per user against that project.
			</p>

			<h2>Claude app (claude.ai and desktop)</h2>
			<p>
				Add Specboard as a connector so any chat can read and update your board: in
				Claude's settings, open <strong>Connectors</strong>, choose{' '}
				<strong>Add custom connector</strong>, and enter{' '}
				<code>https://specboard.io/mcp</code>. You authenticate once and the connector
				is available across web, desktop, and mobile.
			</p>
			<p>
				A connector is account-level, so it does not carry a repo's project binding;
				Claude will see all of your projects and ask which one to use.
			</p>

			<h2>Cloud VMs (Claude Code on the web, CI sandboxes)</h2>
			<p>
				Cloud environments rebuild their container for every session and start behind
				a restrictive egress proxy, so a plain plugin install neither succeeds nor
				survives. Three one-time settings fix this.
			</p>
			<p>
				<strong>1. Allow the network.</strong> Add <code>specboard.io</code> to the
				environment's network allowlist. The default policy blocks it, which prevents
				the plugin catalog from being fetched at all.
			</p>
			<p>
				<strong>2. Reinstall on startup.</strong> Plugins live in a directory that is
				discarded with the container, so add this to the environment's startup script:
			</p>
			<pre><code>{startupScript}</code></pre>
			<p>
				Both commands are idempotent and safe to run every session.{' '}
				<code>--scope user</code> installs the plugin for every repo in the VM.
			</p>
			<p>
				<strong>3. Authenticate through a connector.</strong> A headless session
				cannot complete the MCP OAuth browser redirect, so add Specboard as a
				claude.ai connector (previous section) instead. It authenticates once at the
				account level and works in cloud sessions. Never put a token in a startup
				script.
			</p>

			<h2>Using it</h2>
			<p>
				From any connected session, ask "what's next?" or run{' '}
				<code>/specboard:whats-next</code>. Claude queries your projects, checks local
				git state, and recommends what to pick up; as work progresses it keeps the
				board current: scoping, task breakdown, status, branches, and PRs.
			</p>

			<p class="setup-home-link">
				<a href="/">Back to Specboard</a>
			</p>
		</div>
	);
}
