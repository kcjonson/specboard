# Switch from pnpm to npm Workspaces

## Problem
pnpm creates per-package `node_modules` directories (symlinks) even with hoisting enabled. With Docker bind mounts, these sync back to the host filesystem. Adding volume exclusions for each package doesn't scale.

## Solution
Switch to npm workspaces, which creates only a single root `node_modules` with symlinks for internal workspace packages - no per-package node_modules directories.

## Trade-offs
- **Loses**: pnpm's disk efficiency (hard links to content-addressable store)
- **Gains**: Simple node_modules structure compatible with Docker volume exclusion
- **Neutral**: Disk efficiency doesn't matter in ephemeral containers

---

## Files to Modify

### 1. Delete
- `pnpm-lock.yaml` - pnpm lockfile
- `pnpm-workspace.yaml` - pnpm workspace config (npm uses package.json)

### 2. Update `.npmrc`
Remove pnpm-specific settings:
```
# Delete: shamefully-hoist=true
# Delete: node-linker=hoisted
```

### 3. Update root `package.json`
- Remove `"packageManager": "pnpm@9.15.1"` field
- Remove `"pnpm"` section (overrides) - use npm `"overrides"` instead
- Add `"workspaces"` array:
```json
{
  "workspaces": [
    "api",
    "frontend",
    "mcp",
    "ssg",
    "web",
    "infra",
    "docs-desktop",
    "planning-desktop",
    "shared/*"
  ],
  "overrides": {
    "react": "npm:@preact/compat@^10.25.4",
    "react-dom": "npm:@preact/compat@^10.25.4"
  }
}
```

Update scripts from `pnpm -r` to `npm --workspaces`:
```json
{
  "scripts": {
    "test": "npm run --workspaces --if-present test",
    "typecheck": "npm run --workspaces --if-present typecheck",
    "lint": "npm run --workspaces --if-present lint",
    "lint:fix": "npm run --workspaces --if-present lint:fix",
    "clean": "npm run --workspaces --if-present clean && rm -rf node_modules"
  }
}
```

### 4. Update `docker-compose.yml`
Change `pnpm` commands to `npm`:
- `pnpm install` → `npm install`
- Commands already run node directly, no other changes needed

### 5. Update Dockerfiles (api, frontend, mcp)
Change `pnpm` to `npm`:
- `npm install -g pnpm@9.15.1` → remove (npm is built-in)
- `pnpm install` → `npm install`

### 6. Update workspace dependencies in all package.json files
pnpm uses `"workspace:*"` syntax. npm uses `"*"` for workspace deps.

Find and replace in all package.json files:
```
"workspace:*" → "*"
```

Affected files (~20 package.json files with workspace deps).

### 7. Revert `web/vite.config.ts`
Keep the `../node_modules/` paths since with npm workspaces everything is at root.

---

## Verification

1. Clean host: `git clean -fdx -e '.claude/settings.local.json' -e 'docker-compose.override.yml' -e 'infra/cdk.context.json'`
2. Run `npm install` in container
3. Check `git clean -fdxn` shows only the 3 local config files
4. Verify app works: login page loads, can authenticate
