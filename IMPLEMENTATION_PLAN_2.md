# PathCollab: Implementation Plan 2 (Simplified, Viewer-First)

## 1. Problem statement

The current architecture and UX flow are too complex for a reliable, debuggable MVP and do not align with the stated product philosophy that the landing page should be the app itself. Multiple services with inconsistent ports, mixed origin assumptions, and an over-specified overlay pipeline create fragile setup steps and difficult debugging. The app should be instantly usable on first load, with collaboration and overlays as simple, discoverable enhancements rather than gated steps.

## 2. Areas for simplification to make the app extremely intuitive, user-friendly, and seamless

- Single-origin by default: serve the UI and API from one origin and proxy tiles through the server to eliminate CORS and reduce setup steps.
- Viewer-first landing: load a slide immediately (demo or last used) and show controls in a left sidebar next to the viewer.
- Session flow minimized: auto-create a session in the background when collaboration is enabled; display a copyable link without extra prompts.
- Overlay pipeline simplified: start with a single overlay path (raster tiles or simple JSON) and defer complex WebGL2 polygon rendering.
- Reduce moving parts: local disk storage by default; optional S3 and background workers only when needed.
- Debuggability built in: a visible debug panel with connection state, tile request status, overlay progress, and logs.
- Polished UX: consistent type scale, spacing, and visual hierarchy; sidebar-driven navigation; premium feel with refined states and transitions.

## 3. Implementation roadmap

### Phase 0: Architecture stabilization (1 week)
- Unify port usage and routing assumptions across README, docker-compose, and config.
- Make the server the single origin in production; in dev, proxy through the dev server to keep one origin.
- Add a "dev solo mode" that bypasses WS/session when desired.
Deliverable: a single command starts a working viewer with no CORS errors.

### Phase 1: Viewer-first UX and layout (1 week)
- Replace the landing page with the viewer itself.
- Implement a left sidebar layout with logical sections: Session, Slides, People, Layers, Debug.
- Add a compact top status bar showing slide name, connection state, and sharing status.
Deliverable: user sees a slide immediately and can navigate without any setup.

### Phase 2: Simplified session and sharing (1 week)
- Auto-create a session on load (collab enabled) and show a share link.
- Preserve presenter/follower roles implicitly with clear UI cues.
- Add "Follow presenter" toggle for followers with smooth snapping.
Deliverable: collaboration works without explicit session creation steps.

### Phase 3: Overlay pipeline simplification (1-2 weeks)
- Support a single, stable overlay format.
- Render overlays using Canvas2D first for reliability; keep WebGL2 as a later optimization.
- Make overlays optional and clearly toggled in the sidebar.
Deliverable: overlays are reliable and easy to debug.

### Phase 4: Debuggability and testing foundations (1-2 weeks)
- Add deterministic fixtures for slides and overlays.
- Add Playwright smoke tests for viewer load, pan/zoom, and join flow.
- Add unit tests for session state and presence aggregation.
Deliverable: tests are deterministic and runnable without external services.

### Phase 5: Visual polish and UX refinement (1 week)
- Refine typography, spacing, and hierarchy for a premium feel.
- Add small animations for sidebar reveal, load transitions, and state changes.
- Polish empty states and errors with clear actions.
Deliverable: UI feels premium, cohesive, and Stripe-level in clarity.

## 4. Extremely detailed task list

### 4.1 Architecture and configuration
- [ ] Pick canonical ports for web, and server and update all docs and configs to match.
- [ ] Remove entirely WSIStreamer as a slide backend. We now assume that the slide are locally accessible via openslide.
- [ ] Ensure server proxies tile requests so the browser only talks to one origin.
- [ ] Add a single `PUBLIC_BASE_URL` config and use it consistently for link generation.
- [ ] Add a "dev solo mode" flag that disables WS and sessions while keeping the viewer functional.
- [ ] Create a clear environment matrix: dev, local docker, and production.
- [ ] Remove or disable S3/MinIO requirements from the default dev path.
- [ ] Add explicit startup health checks for web, server, and tile proxy endpoints.
- [ ] Make all config defaults safe and runnable without extra setup.

### 4.2 Server: API and session simplification
- [ ] Add an endpoint that returns a default slide id (demo or last used).
- [ ] Auto-create a session in the background if collab is enabled.
- [ ] Provide a simple "share link" response with a single token by default.
- [ ] Move advanced join secrets and presenter keys behind a config flag.
- [ ] Reduce WS message types to a minimal set: presence, viewport, session, debug.
- [ ] Implement a single server tick loop for presence and viewport updates.
- [ ] Add structured logs with clear event names and session ids.
- [ ] Add a debug endpoint to expose session state and connection counts.

### 4.3 Frontend: viewer-first landing flow
- [ ] Remove the current landing page flow that requires a session creation step.
- [ ] On load, resolve a slide id and render the viewer immediately.
- [ ] Show a minimal loading state only while tile metadata loads.
- [ ] Make "Copy link" available in the sidebar at all times.
- [ ] Keep the UI fully usable without collaboration enabled.

### 4.4 Layout and UX: left sidebar + viewer
- [ ] Implement a two-pane layout: left sidebar, right viewer canvas.
- [ ] Sidebar sections:
  - [ ] Session: status, copy link, connection indicator.
  - [ ] Slides: list, search, recent, and quick switch.
  - [ ] People: participant list with roles and colors.
  - [ ] Layers: overlay toggles and opacity controls.
  - [ ] Debug: connection, tile requests, overlay progress, errors.
- [ ] Add a compact top status bar with slide name and connection badge.
- [ ] Ensure sidebar is collapsible and keyboard-accessible.
- [ ] Add clearly labeled tooltips for uncommon actions.

### 4.5 Visual design and polish
- [ ] Define design tokens for typography, spacing, colors, and radii.
- [ ] Use a premium, non-default font stack (self-hosted or bundled).
- [ ] Create consistent button styles: primary, secondary, ghost.
- [ ] Use subtle gradients or textures for background to avoid flatness.
- [ ] Add soft shadows and separators to establish hierarchy.
- [ ] Provide premium empty states with simple guidance.
- [ ] Add micro-animations for load, sidebar reveal, and toggles.
- [ ] Validate dark-on-light contrast and readability.

### 4.6 Interaction and usability refinements
- [ ] Add a "Follow presenter" toggle for followers.
- [ ] Provide a "Jump to presenter" button with smooth animation.
- [ ] Make the "Copy link" action show a clear confirmation state.
- [ ] Add keyboard shortcuts for sidebar toggle, zoom reset, and follow toggle.
- [ ] Add contextual tips that appear only once per session.
- [ ] Ensure pointer and touch gestures are intuitive and consistent.

### 4.7 Overlay pipeline simplification
- [ ] Pick one overlay format for the MVP (raster tiles or simple JSON).
- [ ] Document and validate the overlay schema in the server.
- [ ] Add a minimal upload flow that stores overlays locally.
- [ ] Render overlays using Canvas2D for reliability.
- [ ] Add clear toggles for overlay visibility and opacity.
- [ ] Add an overlay load progress indicator and clear error states.

### 4.8 Debuggability and diagnostics
- [ ] Build a debug panel in the sidebar with:
  - [ ] WS connection state and retry count.
  - [ ] Tile request count and error count.
  - [ ] Overlay load progress and last error.
  - [ ] Current session id and role.
- [ ] Add a lightweight in-app log view with copy-to-clipboard.
- [ ] Add a network error banner for offline or proxy issues.
- [ ] Add a "Reset app state" action for fast recovery in dev.

### 4.9 Testing and fixtures
- [ ] Create a small demo slide and a tiny overlay file for tests.
- [ ] Add unit tests for session creation, role assignment, and presence aggregation.
- [ ] Add Playwright tests:
  - [ ] Viewer loads and tiles render.
  - [ ] Pan and zoom works.
  - [ ] Copy link works.
  - [ ] Follower join + follow presenter.
- [ ] Add a mock tile server for CI if needed.
- [ ] Add a "solo mode" test suite that does not require WS.

### 4.10 Docs and onboarding
- [ ] Update README to reflect the viewer-first flow.
- [ ] Document the default slide behavior and how to change it.
- [ ] Provide a minimal "dev quick start" without external services.
- [ ] Add a "Troubleshooting" section for CORS, WS, and tile proxy issues.
- [ ] Add a short "UX principles" section so contributors keep the same feel.

### 4.11 Quality gates
- [ ] Add lint and format tasks for both frontend and backend.
- [ ] Add a smoke test script that runs the full stack and checks health.
- [ ] Add a "debug report" script that prints version, config, and service status.

### 4.12 Release and polish pass
- [ ] Run a UI polish sweep focused on spacing, alignments, and typography.
- [ ] Validate the app on common screen sizes and zoom levels.
- [ ] Fix any jitter or scroll issues in the viewer and sidebar.
- [ ] Ensure all empty states and errors have clear next steps.
- [ ] Confirm that the landing page is the app, with no extra steps.
