# COMPLETE - 2026-01-09

# Specboard Homepage Update

## Overview

Redesign the marketing home page for **Specboard** - "Workflow tools for AI assisted product development" targeting software developers and product people working with AI coding agents.

## Key Changes

### Branding
- Rename from "Doc Platform" to "Specboard"
- New tagline: "Workflow tools for AI assisted product development"
- Update copyright to 2025

### Visual Style
- Light by default with dark mode support (already in tokens.css)
- Developer-focused typography with monospace accents for code-related elements
- Clean, minimal aesthetic that feels like a professional dev tool
- Keep existing design tokens for consistency

### Page Structure (Hero + Features + How it works + CTA)

1. **Hero Section**
   - Headline: Focus on AI-assisted product development
   - Subtitle: Explain the value prop for developers working with AI agents
   - Two CTAs: "Get Started" + "Learn More"

2. **Features Section (Two Feature Spotlights)**
   - **Specs & Docs** (Documentation Editor)
     - Git-backed markdown with WYSIWYG/raw modes
     - Inline comments for collaboration
     - AI-powered writing assistance
     - Position: "Give your AI agent the context it needs"

   - **Planning** (Kanban Board)
     - Epic/Task hierarchy
     - Keyboard-first interface
     - Lightweight and fast
     - Position: "Track what you're building, what's for the AI"

3. **How It Works Section**
   - 3-step flow showing the workflow
   - Step 1: Write specs and requirements
   - Step 2: Organize into tasks
   - Step 3: Hand off to AI agents with full context

4. **CTA Section**
   - Final call-to-action before footer
   - "Start building with AI" messaging

5. **Footer**
   - Minimal: Copyright 2025 Specboard

## Files to Modify

1. **`/Volumes/Code/doc-platform/ssg/src/pages/home.tsx`**
   - Replace all content with new Specboard branding
   - New hero, features, how-it-works, and CTA sections
   - Update auth link text from "Doc Platform" to "Specboard"

2. **`/Volumes/Code/doc-platform/ssg/src/styles/home.css`**
   - Add styles for new sections (how-it-works, final CTA)
   - Add developer-focused typography styles (monospace accents)
   - Ensure dark mode looks good
   - Add feature card icons/visual polish

## Implementation Details

### home.tsx Structure

```tsx
<div class="home-container">
  <header class="home-header">
    <a href="/" class="logo">Specboard</a>
    <nav>Sign In | Get Started</nav>
  </header>

  <section class="hero">
    <h1>Build better software with AI</h1>
    <p>Specs, planning, and context management for developers working with AI coding agents.</p>
    <CTAs />
  </section>

  <section class="features">
    <h2>Two tools. One workflow.</h2>
    <div class="feature-grid">
      <FeatureCard title="Specs & Docs" ... />
      <FeatureCard title="Planning" ... />
    </div>
  </section>

  <section class="how-it-works">
    <h2>How it works</h2>
    <div class="steps">
      <Step number="1" title="Write your specs" />
      <Step number="2" title="Break into tasks" />
      <Step number="3" title="Build with AI" />
    </div>
  </section>

  <section class="cta-section">
    <h2>Ready to build with AI?</h2>
    <a href="/signup">Get Started Free</a>
  </section>

  <footer>© 2025 Specboard</footer>
</div>
```

### CSS Additions

- `.how-it-works` - New section for the 3-step flow
- `.steps` - Grid layout for steps
- `.step` - Individual step card with number
- `.cta-section` - Final CTA section styling
- Monospace accents using `var(--font-mono)`
- Subtle code-block styling for technical feel

## Messaging Guidelines

- **Do NOT say "vibe coding"**
- Focus on: specs, planning, context, documentation
- AI agents need clear specifications to work well
- This is about professional software development, not casual coding
- Emphasize collaboration between human developers and AI
