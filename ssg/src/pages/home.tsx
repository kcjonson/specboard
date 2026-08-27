/**
 * Specboard marketing home page
 * The project system for AI-assisted development
 */
import type { JSX } from 'preact';
import { BrandLogo } from '../components/logo';

/**
 * Client-side scripts for:
 * 1. Session detection (Open App vs Sign In)
 * 2. Early access form submission
 */
export const homeScript = `
(function() {
	// Session detection
	var authLink = document.getElementById('auth-link');
	if (authLink) {
		var cookies = document.cookie ? document.cookie.split('; ') : [];
		var hasSession = cookies.some(function(c) { return c.indexOf('session_id=') === 0; });
		if (hasSession) {
			authLink.href = '/';
			authLink.textContent = 'Open App';
		}
		authLink.style.visibility = 'visible';
	}

	// Early access form
	var form = document.getElementById('early-access-form');
	if (form) {
		var errorEl = document.getElementById('form-error');
		var successEl = document.getElementById('form-success');
		var formFields = document.getElementById('form-fields');
		var submitBtn = document.getElementById('ea-submit');

		form.addEventListener('submit', function(e) {
			e.preventDefault();
			if (errorEl) errorEl.classList.add('hidden');

			// Normalize the same way the API does before both sending and
			// displaying, so the address shown back is exactly the recipient.
			// The trim also matters: the API validates before it normalizes,
			// so an untrimmed address would 400 rather than sign up.
			var email = document.getElementById('ea-email').value.trim().toLowerCase();
			var company = document.getElementById('ea-company').value;
			var role = document.getElementById('ea-role').value;
			var useCase = document.getElementById('ea-use-case').value;

			submitBtn.disabled = true;
			submitBtn.textContent = 'Submitting...';

			fetch('/api/waitlist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: email,
					company: company,
					role: role,
					use_case: useCase
				})
			})
			.then(function(res) {
				return res.json().then(function(data) {
					return { ok: res.ok, data: data };
				});
			})
			.then(function(result) {
				if (result.ok) {
					// textContent, not innerHTML: this is user input echoed
					// back into the page and the input type is not a sanitizer.
					var successEmailEl = document.getElementById('ea-success-email');
					if (successEmailEl) successEmailEl.textContent = email;
					if (formFields) formFields.style.display = 'none';
					if (successEl) successEl.classList.remove('hidden');
				} else {
					if (errorEl) {
						errorEl.textContent = result.data.error || 'Something went wrong. Please try again.';
						errorEl.classList.remove('hidden');
					}
					submitBtn.disabled = false;
					submitBtn.textContent = 'Request Access';
				}
			})
			.catch(function() {
				if (errorEl) {
					errorEl.textContent = 'Network error. Please try again.';
					errorEl.classList.remove('hidden');
				}
				submitBtn.disabled = false;
				submitBtn.textContent = 'Request Access';
			});
		});
	}
})();
`;

export function HomeContent(): JSX.Element {
	return (
		<div class="home-container">
			{/* Header */}
			<header class="home-header">
				<BrandLogo size={22} href="/" />
				<nav class="home-nav" aria-label="Main navigation">
					<a id="auth-link" class="home-nav-link" href="/login" style="visibility: hidden">Sign In</a>
					<a href="#early-access" class="btn-primary">Request Access</a>
				</nav>
			</header>

			{/* Section 1: Hero */}
			<section class="hero" id="hero">
				<div class="hero-copy">
					<span class="hero-badge">The project system for AI-assisted development</span>
					<h1>Write requirements. Set priorities. Your agents handle the rest.</h1>
					<p class="hero-subtitle">
						AI agents need context, not copy-paste. Specboard connects your docs and tasks
						directly to any MCP-compatible agent—so they know what to build and what matters most.
					</p>
					<div class="hero-cta">
						<a href="#early-access" class="btn-primary btn-large">Request Early Access</a>
						<a href="#how-it-works" class="btn-secondary btn-large">See How It Works</a>
					</div>
				</div>
				<div class="hero-mark" aria-hidden="true">
					<svg viewBox="0 0 240 200">
						<polygon points="28,55 76,87 28,119" />
						<rect class="hero-card" x="108" y="117" width="92" height="30" rx="7" />
						<rect class="hero-ghost" x="126" y="71" width="92" height="30" rx="7" />
						<rect class="hero-ghost-far" x="126" y="25" width="92" height="30" rx="7" />
					</svg>
				</div>
			</section>

			{/* Section 2: Who It's For */}
			<section class="who-its-for" id="who-its-for">
				<h2>For everyone in the AI development loop</h2>
				<div class="audience-grid">
					<div class="audience-card home-card">
						<div class="audience-header">
							<div class="audience-icon">
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
									<polyline points="14 2 14 8 20 8"></polyline>
									<line x1="16" y1="13" x2="8" y2="13"></line>
									<line x1="16" y1="17" x2="8" y2="17"></line>
								</svg>
							</div>
							<h3>For Product People</h3>
						</div>
						<ul>
							<li>Write requirements that agents can actually read</li>
							<li>See what's being worked on and what's done</li>
							<li>Stay in control—agents can't close epics without you</li>
							<li>No more "that's not what I meant in the spec"</li>
						</ul>
					</div>
					<div class="audience-card home-card">
						<div class="audience-header">
							<div class="audience-icon">
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="16 18 22 12 16 6"></polyline>
									<polyline points="8 6 2 12 8 18"></polyline>
								</svg>
							</div>
							<h3>For Developers</h3>
						</div>
						<ul>
							<li>Get specs your AI agents can query directly</li>
							<li>Stop copy-pasting context into every session</li>
							<li>Let agents ask "what are the requirements?" and get a real answer</li>
							<li>No more translating between PM-speak and agent prompts</li>
						</ul>
					</div>
				</div>
				<p class="audience-note">
					Whether you're a solo dev wearing both hats, or a product person handing off to
					AI-augmented developers—Specboard is the coordination layer that keeps everyone
					(and every agent) aligned.
				</p>
			</section>

			{/* Section 3: The Problem */}
			<section class="problem" id="problem">
				<h2>The handoff to AI is broken</h2>
				<div class="problem-grid">
					<div class="problem-card home-card">
						<div class="problem-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10"></circle>
								<line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
							</svg>
						</div>
						<div>
							<h3>Scattered context</h3>
							<p>Requirements in Notion, tasks in Jira, specs in Google Docs. Product people
							write detailed specs that never reach the agent intact.</p>
						</div>
					</div>
					<div class="problem-card home-card">
						<div class="problem-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
								<line x1="9" y1="9" x2="15" y2="9"></line>
								<line x1="12" y1="12" x2="12" y2="12"></line>
							</svg>
						</div>
						<div>
							<h3>The telephone game</h3>
							<p>Product writes spec → Dev interprets → Dev prompts agent → Agent guesses.
							By the time context reaches the AI, half of it is gone.</p>
						</div>
					</div>
					<div class="problem-card home-card">
						<div class="problem-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
								<polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
								<line x1="12" y1="22.08" x2="12" y2="12"></line>
							</svg>
						</div>
						<div>
							<h3>Scale breaks everything</h3>
							<p>Full products have hundreds of requirement files. Too many to dump into a
							prompt. No structure to know which docs matter for which task.</p>
						</div>
					</div>
					<div class="problem-card home-card">
						<div class="problem-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
								<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</div>
						<div>
							<h3>Links break as you iterate</h3>
							<p>Plans evolve, specs update, requirements shift. The connections between
							sessions, plans, and requirements drift apart.</p>
						</div>
					</div>
				</div>
			</section>

			{/* Section 4: The Solution */}
			<section class="solution" id="solution">
				<h2>One system. Structured context. Right docs for the right task.</h2>
				<div class="pillars-grid">
					<div class="pillar-card home-card">
						<div class="pillar-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
								<polyline points="14 2 14 8 20 8"></polyline>
								<line x1="16" y1="13" x2="8" y2="13"></line>
								<line x1="16" y1="17" x2="8" y2="17"></line>
							</svg>
						</div>
						<div>
							<h3>Requirements agents can read</h3>
							<p>Git-backed Markdown documentation. True <code>.md</code> files, not
							proprietary blocks. Version history through Git.</p>
						</div>
					</div>
					<div class="pillar-card home-card">
						<div class="pillar-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="3" width="7" height="7"></rect>
								<rect x="14" y="3" width="7" height="7"></rect>
								<rect x="14" y="14" width="7" height="7"></rect>
								<rect x="3" y="14" width="7" height="7"></rect>
							</svg>
						</div>
						<div>
							<h3>Priorities agents can query</h3>
							<p>Simple kanban: Ready → In Progress → Done. Drag to rank.
							Agents ask "what should I work on?" and get a real answer.</p>
						</div>
					</div>
					<div class="pillar-card home-card">
						<div class="pillar-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
								<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
							</svg>
						</div>
						<div>
							<h3>Structured linking</h3>
							<p>Tasks link to their relevant requirement docs. Agent picks up a task
							→ gets the <em>right</em> context, not <em>all</em> context.</p>
						</div>
					</div>
					<div class="pillar-card home-card">
						<div class="pillar-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 2L2 7l10 5 10-5-10-5z"></path>
								<path d="M2 17l10 5 10-5"></path>
								<path d="M2 12l10 5 10-5"></path>
							</svg>
						</div>
						<div>
							<h3>MCP that just works</h3>
							<p>Native MCP server included. Works with any MCP-compatible agent.
							Query docs, query tasks, update progress.</p>
						</div>
					</div>
				</div>
			</section>

			{/* Section 5: How It Works */}
			<section class="how-it-works" id="how-it-works">
				<h2>From brief to shipped, with full visibility</h2>
				<div class="workflow">
					<div class="workflow-step">
						<div class="step-header">
							<div class="step-number">1</div>
							<div class="step-role">Product</div>
						</div>
						<h3>Write the spec</h3>
						<p>Create requirements in the documentation editor. Markdown files,
						version-controlled, human-readable.</p>
					</div>
					<div class="workflow-step">
						<div class="step-header">
							<div class="step-number">2</div>
							<div class="step-role">Product</div>
						</div>
						<h3>Set priorities</h3>
						<p>Create epics on the kanban board. Drag to rank what matters most.
						Link epics to their requirement docs.</p>
					</div>
					<div class="workflow-step">
						<div class="step-header">
							<div class="step-number">3</div>
							<div class="step-role">Agent</div>
						</div>
						<h3>Agent gets context</h3>
						<p>Agent connects via MCP. Queries requirements directly.
						No copy-paste. No re-explaining.</p>
					</div>
					<div class="workflow-step">
						<div class="step-header">
							<div class="step-number">4</div>
							<div class="step-role">Dev + Agent</div>
						</div>
						<h3>Work happens</h3>
						<p>Agent breaks down epics into tasks. Implements, tests, iterates.
						Progress visible to everyone.</p>
					</div>
					<div class="workflow-step">
						<div class="step-header">
							<div class="step-number">5</div>
							<div class="step-role">Product</div>
						</div>
						<h3>Review & approve</h3>
						<p>Review the PR. Mark epic complete. Agent can't close the loop—humans
						stay in control.</p>
					</div>
				</div>
				<div class="terminal" aria-hidden="true">
					<div class="terminal-line">
						<span class="terminal-prompt">▸</span>
						<span class="terminal-strong">claude &gt; what should I work on next?</span>
					</div>
					<div class="terminal-line">
						<span class="terminal-prompt terminal-prompt-hidden">▸</span>
						<span>reading specboard — 2 epics ready, checkout flow is top priority</span>
					</div>
					<div class="terminal-line">
						<span class="terminal-prompt terminal-prompt-hidden">▸</span>
						<span>pulling spec: <span class="terminal-file">checkout-flow.md</span> · 4 requirements, 2 open comments</span>
					</div>
					<div class="terminal-line">
						<span class="terminal-prompt terminal-prompt-hidden">▸</span>
						<span class="terminal-chip"><span class="terminal-chip-dot"></span>Checkout flow → In Progress</span>
					</div>
					<div class="terminal-line">
						<span class="terminal-prompt">▸</span>
						<span class="terminal-cursor"></span>
					</div>
				</div>
			</section>

			{/* Section 6: Comparison */}
			<section class="comparison" id="comparison">
				<h2>Why not just use...?</h2>
				<div class="comparison-wrapper">
					<table class="comparison-table">
						<thead>
							<tr>
								<th>What you're using</th>
								<th>The problem</th>
								<th>How we're different</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Notion + Jira</td>
								<td><span class="comparison-negative">AI can't read either. Two systems = scattered context.</span></td>
								<td><span class="comparison-positive">One integrated system with native MCP.</span></td>
							</tr>
							<tr>
								<td>Markdown in repo</td>
								<td><span class="comparison-negative">Static. Gets stale. No task management. No structure.</span></td>
								<td><span class="comparison-positive">Living docs + prioritized tasks, linked and queryable.</span></td>
							</tr>
							<tr>
								<td>Linear / Shortcut</td>
								<td><span class="comparison-negative">Great for tasks, but no MCP. Requirements live elsewhere.</span></td>
								<td><span class="comparison-positive">Docs + tasks + MCP in one tool.</span></td>
							</tr>
							<tr>
								<td>ChatPRD / AI PRD tools</td>
								<td><span class="comparison-negative">Generate docs <em>from</em> AI, not <em>for</em> AI. No agent integration.</span></td>
								<td><span class="comparison-positive">Built specifically for agent consumption via MCP.</span></td>
							</tr>
							<tr>
								<td>DIY (Obsidian + Issues)</td>
								<td><span class="comparison-negative">Glue code. No unified context. No MCP.</span></td>
								<td><span class="comparison-positive">Purpose-built, zero integration work.</span></td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>

			{/* Section 7: Control */}
			<section class="control" id="control">
				<h2>AI assists. Humans decide.</h2>
				<div class="control-grid">
					<div class="control-point home-card">
						<div class="control-icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 20h9"></path>
								<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
							</svg>
						</div>
						<div>
							<h3>Product people write specs</h3>
							<p>They define what gets built.</p>
						</div>
					</div>
					<div class="control-point home-card">
						<div class="control-icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="8" y1="6" x2="21" y2="6"></line>
								<line x1="8" y1="12" x2="21" y2="12"></line>
								<line x1="8" y1="18" x2="21" y2="18"></line>
								<line x1="3" y1="6" x2="3.01" y2="6"></line>
								<line x1="3" y1="12" x2="3.01" y2="12"></line>
								<line x1="3" y1="18" x2="3.01" y2="18"></line>
							</svg>
						</div>
						<div>
							<h3>Product people set priorities</h3>
							<p>They decide what matters most.</p>
						</div>
					</div>
					<div class="control-point home-card">
						<div class="control-icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
							</svg>
						</div>
						<div>
							<h3>Agents propose work</h3>
							<p>They create subtasks and submit PRs.</p>
						</div>
					</div>
					<div class="control-point home-card">
						<div class="control-icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="9 11 12 14 22 4"></polyline>
								<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
							</svg>
						</div>
						<div>
							<h3>Humans approve completion</h3>
							<p>Agents can't mark epics "done."</p>
						</div>
					</div>
					<div class="control-point home-card">
						<div class="control-icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
								<circle cx="12" cy="12" r="3"></circle>
							</svg>
						</div>
						<div>
							<h3>Everyone sees the same context</h3>
							<p>No more "that's not what I meant."</p>
						</div>
					</div>
					<div class="control-point home-card">
						<div class="control-icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="4"></circle>
								<line x1="1.05" y1="12" x2="7" y2="12"></line>
								<line x1="17.01" y1="12" x2="22.96" y2="12"></line>
							</svg>
						</div>
						<div>
							<h3>Git-backed everything</h3>
							<p>Full history, portable, no lock-in.</p>
						</div>
					</div>
				</div>
			</section>

			{/* Section 8: MCP Architecture */}
			<section class="mcp-architecture" id="mcp">
				<h2>Built on the standard, not bolted on</h2>
				<p class="mcp-intro">
					MCP (Model Context Protocol) is the open standard for connecting AI agents to tools
					and data. We didn't retrofit MCP onto an existing product—we built MCP-first from day one.
				</p>
				<div class="mcp-content">
					<div class="mcp-capabilities home-card">
						<h3>What your agent can do</h3>
						<ul class="capability-list">
							<li><code>get_epic</code> — Read epic details and linked specs</li>
							<li><code>get_current_work</code> — See what's in progress</li>
							<li><code>get_ready_epics</code> — Find prioritized work to pick up</li>
							<li><code>create_task</code> — Break down work into subtasks</li>
							<li><code>complete_task</code> — Mark tasks as done</li>
							<li><code>add_progress_note</code> — Log activity for visibility</li>
						</ul>
					</div>
					<div class="mcp-note home-card">
						<p>Works with any MCP-compatible agent: Claude Code, Cursor, Windsurf,
						and any tool that supports the protocol.</p>
					</div>
				</div>
			</section>

			{/* Section 9: Data Control */}
			<section class="data-control" id="data">
				<h2>Your data, your control</h2>
				<div class="data-points">
					<div class="data-point home-card">
						<div class="data-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="4"></circle>
								<line x1="1.05" y1="12" x2="7" y2="12"></line>
								<line x1="17.01" y1="12" x2="22.96" y2="12"></line>
							</svg>
						</div>
						<div>
							<h3>Git-backed</h3>
							<p>Your docs live in a git repository you control. Full version history built in.</p>
						</div>
					</div>
					<div class="data-point home-card">
						<div class="data-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
								<polyline points="14 2 14 8 20 8"></polyline>
								<line x1="16" y1="13" x2="8" y2="13"></line>
								<line x1="16" y1="17" x2="8" y2="17"></line>
							</svg>
						</div>
						<div>
							<h3>True Markdown</h3>
							<p>Plain <code>.md</code> files, not proprietary formats. Read them anywhere,
							edit them with any tool.</p>
						</div>
					</div>
					<div class="data-point home-card">
						<div class="data-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
								<polyline points="7 10 12 15 17 10"></polyline>
								<line x1="12" y1="15" x2="12" y2="3"></line>
							</svg>
						</div>
						<div>
							<h3>Export anytime</h3>
							<p>Your docs are just markdown. Leave whenever you want.
							No data hostage situation.</p>
						</div>
					</div>
				</div>
			</section>

			{/* Section 10: Early Access */}
			<section class="early-access" id="early-access">
				<h2>Request early access</h2>
				<p class="early-access-subtitle">
					We're rolling out to select teams. Join the waitlist.
				</p>

				<form id="early-access-form" class="early-access-form home-card">
					<div id="form-error" class="form-error hidden"></div>
					<div id="form-success" class="form-success hidden">
						<div class="success-icon">
							<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
						</div>
						<div class="form-success-text">
							<h3>You're on the list.</h3>
							<p>
								We sent a confirmation to <span id="ea-success-email"></span>. We'll be in
								touch when a spot opens up.
							</p>
						</div>
					</div>

					<div id="form-fields">
						<div class="form-group">
							<label for="ea-email">Email <span class="required">*</span></label>
							<input
								type="email"
								id="ea-email"
								name="email"
								required
								autocomplete="email"
								placeholder="you@company.com"
							/>
						</div>

						<div class="form-row">
							<div class="form-group">
								<label for="ea-company">Company</label>
								<input
									type="text"
									id="ea-company"
									name="company"
									autocomplete="organization"
									placeholder="Acme Inc"
								/>
							</div>
							<div class="form-group">
								<label for="ea-role">Your role</label>
								<input
									type="text"
									id="ea-role"
									name="role"
									autocomplete="organization-title"
									placeholder="Product Manager"
								/>
							</div>
						</div>

						<div class="form-group">
							<label for="ea-use-case">How do you plan to use Specboard?</label>
							<textarea
								id="ea-use-case"
								name="use_case"
								rows={3}
								placeholder="Tell us about your team and workflow..."
							></textarea>
						</div>

						<button type="submit" id="ea-submit" class="btn-primary btn-large btn-full">
							Request Access
						</button>
					</div>
				</form>

				<div class="early-access-benefits">
					<div class="benefit">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="20 6 9 17 4 12"></polyline>
						</svg>
						<span>Priority onboarding</span>
					</div>
					<div class="benefit">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="20 6 9 17 4 12"></polyline>
						</svg>
						<span>Direct founder access</span>
					</div>
					<div class="benefit">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="20 6 9 17 4 12"></polyline>
						</svg>
						<span>Shape the roadmap</span>
					</div>
					<div class="benefit">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="20 6 9 17 4 12"></polyline>
						</svg>
						<span>Founder pricing forever</span>
					</div>
				</div>
			</section>

			{/* Section 11: Final CTA */}
			<section class="final-cta">
				<svg class="final-cta-mark" viewBox="0 0 240 150" aria-hidden="true">
					<polygon points="28,30 76,62 28,94" />
					<rect class="final-cta-ghost" x="126" y="46" width="92" height="30" rx="7" />
					<rect x="108" y="92" width="92" height="30" rx="7" />
				</svg>
				<h2>Give your AI agents a proper brief</h2>
				<p>Stop copy-pasting context. Start shipping what you actually meant.</p>
				<a href="#early-access" class="btn-primary btn-large">Request Early Access</a>
			</section>

			{/* Footer */}
			<footer class="home-footer">
				<p>&copy; {new Date().getFullYear()} Specboard. All rights reserved. <a href="/privacy">Privacy &amp; Security</a></p>
			</footer>
		</div>
	);
}
