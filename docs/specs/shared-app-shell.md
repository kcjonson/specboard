# Shared App Shell

How one codebase runs on seven targets: large-screen web, small-screen web, iOS, Android, macOS, Windows, and Linux.

> **Related specs**: [Platform Abstraction](./platform-abstraction.md) for the injected capability interfaces, [Project Storage](./project-storage.md) for local vs cloud file access, [Marketing SSG](./marketing-ssg.md) for the static pages that sit outside the SPA.

---

## Principle

There is one application. Every target loads the same Preact components, the same CSS Modules, the same router, and the same models. A target contributes exactly three things: a shell that hosts the web build, a platform implementation injected into it, and a packaging step.

Nothing above the platform boundary is allowed to branch on target. A component that needs to know whether it is on a phone asks about viewport size or pointer type, not about iOS.

---

## Targets

| Target | Shell | Platform implementation | Packaging |
|--------|-------|------------------------|-----------|
| Large-screen web | Browser | `platform-web` | Vite build served by the frontend container |
| Small-screen web | Browser | `platform-web` | Same bundle, responsive layout |
| iOS | Capacitor | `platform-capacitor` | Xcode project, App Store |
| Android | Capacitor | `platform-capacitor` | Gradle project, Play Store |
| macOS | Electron | `platform-electron` | electron-builder (dmg) |
| Windows | Electron | `platform-electron` | electron-builder (nsis) |
| Linux | Electron | `platform-electron` | electron-builder (AppImage, deb) |

Small-screen web shipped 2026-08 and is a first-class target, not a courtesy. It is also the cheapest proxy for the mobile apps: if the browser at 390px is wrong, the Capacitor build is wrong, and it is faster to catch in a resized browser window than in a simulator.

---

## Capacitor, not React Native

Capacitor runs our existing web build inside a native WebView and exposes native capability through plugins. React Native would run our logic against a native view tree with its own component and styling model.

The decision follows from the principle above. Capacitor keeps one component library, one styling system, and one router. React Native forks all three: `@specboard/ui` would need a native twin, CSS Modules would become StyleSheet objects, and the editor (Slate, contenteditable, DOM selection) has no meaningful React Native equivalent at all. Every feature would then be built twice, forever, and the second build would always lag.

What we give up is native rendering performance and native-feeling stock controls. For a document editor and a kanban board, both of which are already DOM-shaped, that trade is cheap. It also matches what Electron already does on desktop, so both native shells work the same way, and the mental model is one idea instead of two.

Escape hatch: if a specific surface ever needs true native rendering, Capacitor allows a native view for that surface without rewriting the app around it.

---

## Package Layout

```
shared/
├── pages/                  # Editor components          (all targets)
├── planning/               # Planning components        (all targets)
├── ui/                     # Design system              (all targets)
├── models/                 # State                      (all targets)
├── router/                 # Routing                    (all targets)
├── platform/               # Capability contract + provider
├── platform-web/           # Browser implementation
├── platform-electron/      # Electron implementation
└── platform-capacitor/     # Capacitor implementation   (planned)
web/                        # The app: entry, routes, Vite config
desktop/                    # Electron shell             (planned, replaces docs-desktop + planning-desktop)
mobile/                     # Capacitor shell            (planned)
```

`web/` builds the bundle. `desktop/` and `mobile/` consume that same build output rather than compiling their own copy of the app, which is what keeps the three from drifting.

The two current Electron scaffolds, `docs-desktop/` and `planning-desktop/`, collapse into one `desktop/`. Splitting by product was a mistake carried over from an earlier plan: the web app already serves both products from a single SPA and selects between them by route, and the desktop shell has no reason to differ.

---

## Responsive Strategy

Already settled and shipped. [tech-stack.md](../tech-stack.md#responsive-strategy) is the authority: one 768px breakpoint written literally with a `/* bp-small */` marker, capability queries (`pointer: coarse`, `hover: none`) for touch rather than width, CSS over JS, and `interactive-widget=resizes-content` plus `100dvh` takeovers for the on-screen keyboard.

Nothing in this spec overrides those rules, and the mobile shells do not get their own breakpoint tier. A phone through Capacitor is the same viewport the browser already handles at 390px, which is why small-screen web is the cheap proxy for testing mobile: if it is wrong in a resized browser window, it is wrong in the simulator, and the browser tells you faster.

What Capacitor still adds on top of a layout that already responds is the native container, device capability, and store distribution, not a second set of layouts.

---

## What the Native Shells Add

**Session and auth.** Sessions are cookie-based against Redis, which assumes a served HTTP origin. Capacitor serves from `capacitor://localhost` and Electron from a file or custom protocol, so the cookie path does not carry over unchanged. Either the native shells hold a token in secure storage, or they load from a real origin and keep cookies. This is decided once, in the auth task, and applies to both shells.

**Deep links.** OAuth callbacks, magic links, and item links (`/SPE-107`) all need to reach a running app: custom URL scheme plus universal links on iOS, app links on Android, protocol handler on desktop.

**Viewport chrome.** Dynamic viewport units and keyboard handling are already in place from the small-screen work. What is left is native-specific: safe-area insets for the notch and home indicator, status-bar styling, and the Android hardware back button beyond the `CloseWatcher` wiring the takeovers already use.

**Touch drag-and-drop.** The kanban board uses native HTML5 DnD, which does not fire on touch, so small screens change status through the item view instead. That is an accepted limitation on the web today; whether it stays acceptable inside a shipped mobile app is a product call, not a technical one.

**Offline.** Not in scope for the first pass, but the platform boundary is where it would go, and `SyncModel` already anticipates it.

---

## Build Matrix

| Command | Output |
|---------|--------|
| `npm run build --workspace web` | SPA bundle plus Vite manifest |
| `npm run build --workspace desktop` | Platform installers via electron-builder |
| `npm run build --workspace mobile` | Synced native projects, then Xcode or Gradle |

CI builds web on every PR. Native artifacts build on release, since they need macOS runners for iOS and are slow enough to matter.

Note that all local development still runs through Docker Compose, per the repo rule, and the native builds are the one exception where host toolchains (Xcode, Android SDK) are unavoidable. Document that exception rather than pretending it does not exist.

---

## Open Questions

- Does the native session use a token or a served origin? Blocks the Capacitor and Electron auth work.
- Does the mobile build ship the ssg marketing and auth pages at all, or boot straight into the app with sign-in handled in-shell? Affects what `mobile/` bundles and how the OAuth callback returns.
- Local-mode project storage (git on the filesystem) has no sensible mobile equivalent. Mobile is cloud-mode only, which the platform contract has to express rather than assume.
