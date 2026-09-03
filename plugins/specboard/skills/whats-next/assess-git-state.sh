#!/usr/bin/env bash
# Gathers local git and plan file state as JSON for the /whats-next skill.
# Designed to run from any git repository.
# Returns: worktrees, remote branches with recent activity, in-flight plan files, and completed
# plan files still awaiting harvest into the committed docs.
set -euo pipefail

# Verify jq is available (required for JSON assembly)
if ! command -v jq >/dev/null 2>&1; then
	echo '{"error":"jq is required but not installed. Install it via: brew install jq (macOS) or apt-get install jq (Linux)"}' >&2
	exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"

# ── Worktrees ──
worktrees="[]"
if git worktree list --porcelain >/dev/null 2>&1; then
	worktrees=$(git worktree list --porcelain | awk '
		/^worktree / { path = substr($0, 10) }
		/^branch /   { branch = substr($0, 12); sub(/^refs\/heads\//, "", branch) }
		/^$/         { if (path != "") print path "\t" branch; path=""; branch="" }
		END          { if (path != "") print path "\t" branch }
	' | while IFS=$'\t' read -r wt_path wt_branch; do
		jq -n --arg path "$wt_path" --arg branch "$wt_branch" '{path: $path, branch: $branch}'
	done | jq -s '.')
fi

# ── Remote branches with recent activity (last 7 days) ──
git fetch --quiet 2>/dev/null || true
cutoff=$(date -v-7d +%s 2>/dev/null || date -d '7 days ago' +%s 2>/dev/null || echo 0)
remote_branches="[]"
if [ "$cutoff" != "0" ]; then
	remote_branches=$(git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:unix)' refs/remotes/origin/ 2>/dev/null | while read -r branch epoch; do
		if [ "$epoch" -ge "$cutoff" ] 2>/dev/null; then
			short="${branch#origin/}"
			date_str=$(date -r "$epoch" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d "@$epoch" +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo "unknown")
			jq -n --arg branch "$short" --arg lastCommitDate "$date_str" '{branch: $branch, lastCommitDate: $lastCommitDate}'
		fi
	done | jq -s '.' 2>/dev/null || echo '[]')
fi

# ── Plan files ──
# Split by state: no `# COMPLETE` header means the work is still in flight; a header still on disk
# means the work closed without its decisions being harvested into the committed docs.
plans_dir="$REPO_ROOT/.claude/plans"
incomplete_plans="[]"
unharvested_plans="[]"
scan_plans() {
	find "$plans_dir" -name '*.md' -type f -print0 | while IFS= read -r -d '' file; do
		if head -1 "$file" | grep -q '^# COMPLETE'; then
			state="complete"
		else
			state="incomplete"
		fi
		[ "$state" = "$1" ] || continue
		# First H1 that isn't the COMPLETE marker; a real title may start with "C".
		title=$(awk '/^# / && $0 !~ /^# COMPLETE/ { sub(/^# /, ""); print; exit }' "$file")
		title=${title:-$(basename "$file" .md)}
		modified=$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null || echo 0)
		mod_date=$(date -r "$modified" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d "@$modified" +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo "unknown")
		jq -n --arg file "$file" --arg title "$title" --arg modified "$mod_date" '{file: $file, title: $title, modified: $modified}'
	done | jq -s '.' 2>/dev/null || echo '[]'
}
if [ -d "$plans_dir" ]; then
	incomplete_plans=$(scan_plans incomplete)
	unharvested_plans=$(scan_plans complete)
fi

# ── Output ──
jq -n \
	--argjson worktrees "$worktrees" \
	--argjson remote_branches "$remote_branches" \
	--argjson incomplete_plans "$incomplete_plans" \
	--argjson unharvested_plans "$unharvested_plans" \
	'{worktrees: $worktrees, remoteBranches: $remote_branches, incompletePlans: $incomplete_plans, unharvestedPlans: $unharvested_plans}'
