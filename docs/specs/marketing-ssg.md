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

### PageShell Component

Wraps all SSG pages with consistent HTML structure:

```tsx
interface PageShellProps {
  title: string;
  description?: string;
  cssFiles: string[];      // ['/assets/common.ABC.css', '/assets/login.DEF.css']
  children: ComponentChildren;
  scripts?: ComponentChildren;  // Inline scripts for interactivity
}

function PageShell({ title, cssFiles, children, scripts }: PageShellProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {cssFiles.map(href => <link rel="stylesheet" href={href} />)}
      </head>
      <body>
        {children}
        {scripts}
      </body>
    </html>
  );
}
```

### Page Component Example

```tsx
// ssg/src/pages/login.tsx
import { PageShell } from '../components/PageShell';

interface LoginPageProps {
  commonCss: string;
  pageCss: string;
}

export function LoginPage({ commonCss, pageCss }: LoginPageProps) {
  return (
    <PageShell
      title="Login - Doc Platform"
      cssFiles={[commonCss, pageCss]}
      scripts={<LoginScript />}
    >
      <div class="login-container">
        <h1>Sign In</h1>
        <div id="error" class="error-message hidden" />
        <form id="login-form">
          {/* Form fields */}
        </form>
        <div class="signup-link">
          Don't have an account? <a href="/signup">Create one</a>
        </div>
      </div>
    </PageShell>
  );
}

function LoginScript() {
  // Inline script for form handling
  return (
    <script dangerouslySetInnerHTML={{ __html: `
      // Form submission logic
    `}} />
  );
}
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

### Route Updates

```ts
// Serve SSG pages from static/ssg/
app.get('/login', (c) => {
  return c.html(readFileSync('./static/ssg/login.html', 'utf-8'));
});

app.get('/signup', (c) => {
  return c.html(readFileSync('./static/ssg/signup.html', 'utf-8'));
});

app.get('/', async (c) => {
  // For authenticated users, serve SPA
  // For unauthenticated, serve marketing home
  const session = c.get('session');
  if (session) {
    return serveIndex(c);
  }
  return c.html(readFileSync('./static/ssg/home.html', 'utf-8'));
});
```

### Remove Inline Page Renderers

Delete the old template-string based page renderers:
- `frontend/src/pages/login.ts`
- `frontend/src/pages/signup.ts`
- `frontend/src/pages/not-found.ts` (migrate to SSG or keep simple)

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
