# Marketing Static Site Generator (SSG)

## Overview

A build-time static site generator using Preact for server-side rendering of marketing and authentication pages. Pages are pre-rendered to HTML at build time and served via the existing Node frontend server.

## Goals

1. **Preact-based SSG** - Use Preact components for all static pages (not template strings)
2. **Shared CSS bundle** - Common styles (reset, tokens, elements, fonts) shared across all pages
3. **Page-specific CSS bundles** - Each page has its own hashed CSS file
4. **SPA CSS isolation** - SPA has its own CSS bundle (`app.SHA.css`) separate from marketing pages

## Build Output Structure

```
frontend/static/
├── ssg/                           # Generated static pages
│   ├── login.html
│   ├── signup.html
│   ├── home.html                  # Marketing home page
│   └── ... (future marketing pages)
├── assets/
│   ├── common.ABC123.css          # Shared: reset + tokens + elements
│   ├── login.DEF456.css           # Login-specific styles
│   ├── signup.GHI789.css          # Signup-specific styles
│   ├── home.JKL012.css            # Home page styles
│   └── app.MNO345.css             # All SPA styles bundled
├── index.html                     # SPA entry point
└── assets/                        # SPA JS bundles
```

## CSS Strategy

### Common Bundle (`common.SHA.css`)

Manually specified CSS that's shared across all pages:
- `reset.css` - CSS reset
- `tokens.css` - Design tokens (colors, spacing, typography)
- `elements.css` - Base element styles (button, input, textarea, select, form)

This bundle is:
1. Linked from every SSG page
2. Imported by the SPA (cached from initial page load)

### Page-Specific Bundles

Each SSG page has its own CSS bundle containing only that page's styles:
- `login.SHA.css` - Login container, form layout
- `signup.SHA.css` - Signup container, form layout
- `home.SHA.css` - Hero section, features, CTA

### SPA Bundle (`app.SHA.css`)

Contains all CSS for the SPA routes:
- CSS Modules from components
- Any global SPA-specific styles

## Architecture

### Package Structure

```
ssg/                               # New package
├── src/
│   ├── pages/                     # Preact page components
│   │   ├── login.tsx
│   │   ├── signup.tsx
│   │   └── home.tsx
│   ├── styles/                    # Page-specific CSS
│   │   ├── login.css
│   │   ├── signup.css
│   │   └── home.css
│   ├── components/                # Shared SSG components
│   │   └── PageShell.tsx          # HTML document wrapper
│   ├── build.ts                   # Build script
│   └── manifest.ts                # CSS manifest reader
├── package.json
└── tsconfig.json
```

### Build Process

1. **CSS Build (via Vite)**
   - Bundle `common.css` from shared/ui/src sources
   - Bundle each page's CSS separately
   - Output with content hashes

2. **HTML Render (Node script)**
   - Read CSS manifest for hashed filenames
   - Render each page component to HTML string via `preact-render-to-string`
   - Inject CSS links and output `.html` files

### Document Shell (Template Literal)

The HTML document structure is static boilerplate - use a template literal, not Preact:

```ts
// ssg/src/shell.ts
interface PageOptions {
  title: string;
  description?: string;
  cssFiles: string[];    // ['/assets/common.ABC.css', '/assets/login.DEF.css']
  body: string;          // Preact-rendered HTML fragment
  scripts?: string;      // Plain JS string for interactivity
}

export function renderDocument(options: PageOptions): string {
  const { title, description, cssFiles, body, scripts } = options;

  const cssLinks = cssFiles
    .map(href => `<link rel="stylesheet" href="${href}">`)
    .join('\n    ');

  const metaDesc = description
    ? `<meta name="description" content="${escapeHtml(description)}">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${metaDesc}
  <title>${escapeHtml(title)}</title>
  ${cssLinks}
</head>
<body>
  ${body}
  ${scripts ? `<script>${scripts}</script>` : ''}
</body>
</html>`;
}
```

### Page Content Components (Preact)

Preact renders only the body content as a fragment:

```tsx
// ssg/src/pages/login.tsx
export function LoginContent() {
  return (
    <div class="login-container">
      <h1>Sign In</h1>
      <div id="error" class="error-message hidden" />
      <form id="login-form">
        <div class="form-group">
          <label for="identifier">Username or Email</label>
          <input type="text" id="identifier" name="identifier" required autocomplete="username" />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" id="submit-btn">Sign In</button>
      </form>
      <div class="signup-link">
        Don't have an account? <a href="/signup">Create one</a>
      </div>
    </div>
  );
}

// Plain string for form handling logic
export const loginScript = `
(function() {
  var form = document.getElementById('login-form');
  var errorEl = document.getElementById('error');
  // ... form submission logic
})();
`;
```

### Build Script Usage

```ts
// ssg/src/build.ts
import { render } from 'preact-render-to-string';
import { renderDocument } from './shell';
import { LoginContent, loginScript } from './pages/login';

const body = render(<LoginContent />);
const html = renderDocument({
  title: 'Login - Doc Platform',
  cssFiles: [manifest.common, manifest.login],
  body,
  scripts: loginScript,
});

writeFileSync('dist/login.html', html);
```

## Vite Configuration Changes

### Entry Points

```ts
// web/vite.config.ts
rollupOptions: {
  input: {
    // SPA entry
    main: resolve(__dirname, 'index.html'),

    // Common CSS bundle (explicit, not auto-extracted)
    'common': resolve(__dirname, '../shared/ui/src/common.css'),

    // SSG page CSS bundles
    'login': resolve(__dirname, '../ssg/src/styles/login.css'),
    'signup': resolve(__dirname, '../ssg/src/styles/signup.css'),
    'home': resolve(__dirname, '../ssg/src/styles/home.css'),
  },
}
```

### CSS Chunk Strategy

Configure Vite to keep common CSS separate from SPA CSS:

```ts
build: {
  cssCodeSplit: true,
  rollupOptions: {
    output: {
      // Ensure common CSS stays in its own chunk
      manualChunks(id) {
        if (id.includes('shared/ui/src/common.css')) {
          return 'common';
        }
      },
    },
  },
}
```

## Frontend Server Changes

### Performance Requirements

**No disk reads per request.** All static content loaded into memory at startup.

### Static Page Cache

Load all SSG pages and compute preload headers at server startup:

```ts
// frontend/src/static-pages.ts
import { readFileSync } from 'node:fs';

interface CachedPage {
  html: string;
  preloadHeader: string;  // Link header for CSS preload
}

// Extract CSS paths from HTML and build preload header
function buildPreloadHeader(html: string): string {
  const cssRegex = /<link rel="stylesheet" href="([^"]+)">/g;
  const cssFiles: string[] = [];
  let match;
  while ((match = cssRegex.exec(html)) !== null) {
    cssFiles.push(match[1]);
  }
  return cssFiles
    .map(href => `<${href}>; rel=preload; as=style`)
    .join(', ');
}

function loadPage(path: string): CachedPage {
  const html = readFileSync(path, 'utf-8');
  return {
    html,
    preloadHeader: buildPreloadHeader(html),
  };
}

// Load all pages at startup (runs once)
export const pages = {
  login: loadPage('./static/ssg/login.html'),
  signup: loadPage('./static/ssg/signup.html'),
  home: loadPage('./static/ssg/home.html'),
  notFound: loadPage('./static/ssg/not-found.html'),
};
```

### Route Handlers with Preload Headers

```ts
// frontend/src/index.ts
import { pages } from './static-pages.js';

// Serve cached page with preload header
function servePage(c: Context, page: CachedPage): Response {
  return c.html(page.html, 200, {
    'Link': page.preloadHeader,
    'Cache-Control': 'public, max-age=3600',  // 1 hour cache
  });
}

app.get('/login', (c) => servePage(c, pages.login));
app.get('/signup', (c) => servePage(c, pages.signup));

app.get('/', (c) => {
  // Unauthenticated users get marketing home
  // Auth middleware redirects to /login if needed for protected routes
  return servePage(c, pages.home);
});

app.notFound((c) => {
  return c.html(pages.notFound.html, 404, {
    'Link': pages.notFound.preloadHeader,
  });
});
```

### HTTP/2 Preload Headers

The `Link` header triggers browser preload (and HTTP/2 Server Push if ALB supports it):

```
Link: </assets/common.ABC123.css>; rel=preload; as=style,
      </assets/login.DEF456.css>; rel=preload; as=style
```

This sends CSS hints immediately with the HTML response, before the browser parses `<link>` tags.

### Remove Inline Page Renderers

Delete the old template-string based page renderers:
- `frontend/src/pages/login.ts`
- `frontend/src/pages/signup.ts`
- `frontend/src/pages/not-found.ts`

## Build Pipeline

### Turbo Task Order

```json
{
  "pipeline": {
    "ssg#build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "web#build": {
      "dependsOn": ["^build", "ssg#build"],
      "outputs": ["dist/**"]
    },
    "frontend#build": {
      "dependsOn": ["web#build"],
      "outputs": ["dist/**"]
    }
  }
}
```

### Build Commands

```bash
# Build CSS bundles
pnpm --filter web build:css

# Generate static HTML
pnpm --filter ssg build

# Build SPA
pnpm --filter web build

# Copy all to frontend/static
pnpm --filter frontend build:static
```

## Implementation Steps

1. Create `shared/ui/src/common.css` that explicitly imports shared styles
2. Create `ssg/` package with:
   - PageShell component
   - Login, Signup, Home page components
   - Build script using preact-render-to-string
3. Update Vite config for CSS code splitting
4. Update frontend server to serve static HTML files
5. Remove old template-string page renderers
6. Update build pipeline

## Open Questions

1. **Not Found page** - Keep as template string (simple) or migrate to SSG?
2. **Additional marketing pages** - What pages beyond home? (pricing, features, docs?)
3. **Client-side hydration** - Do any pages need hydration, or pure static HTML + vanilla JS?
4. **SEO meta tags** - Add Open Graph, Twitter cards to PageShell?

## Alternatives Considered

1. **Astro** - Full SSG framework, but adds complexity and new tooling
2. **Next.js** - Too heavy, Preact-incompatible core
3. **Separate Vite SSG plugin** - Less control over CSS bundling
4. **Template strings (current)** - Not component-based, harder to maintain complex pages

The chosen approach (custom Preact SSR) provides:
- Full control over CSS bundling
- Reuse of existing Preact components/patterns
- No new framework dependencies
- Simple build-time rendering
