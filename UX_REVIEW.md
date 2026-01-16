# PathCollab Comprehensive UX/UI Review

A merged analysis from two independent reviews, organized by priority to guide implementation toward premium, Stripe-level quality.

---

## Table of Contents

1. [Critical Priority](#1-critical-priority) — Blocking quality, must fix before shipping
2. [High Priority](#2-high-priority) — Significant UX issues affecting core workflows
3. [Medium Priority](#3-medium-priority) — Polish and refinement for professional feel
4. [Low Priority](#4-low-priority) — Nice-to-have enhancements and delighters
5. [Code Quality Issues](#5-code-quality-issues) — Specific bugs and inconsistencies
6. [Open Questions](#6-open-questions) — Product decisions to resolve
7. [Summary](#7-summary)

---

## 1. Critical Priority

These issues fundamentally impact usability and must be addressed before the product feels complete.

### 1.1 No Clear Indication of User Role (Presenter vs Follower)

**Problem**: The user's role is never prominently displayed. The only hints are:
- **Presenter**: Layer controls are enabled
- **Follower**: "Layer controls managed by presenter" in small italics

**Impact**: Users don't understand their capabilities or relationship to others in the session.

**Missing elements**:
- "You are presenting" badge in status bar
- Visual distinction in the user list showing "you"
- Presenter badge/icon next to the presenter's name

**Recommendation**: Add a prominent role indicator:
```
┌─────────────────────────────────────┐
│  You're presenting to 3 viewers    │
└─────────────────────────────────────┘
```

---

### 1.2 Follow Mode UX is Inadequate

**Problem**: The current "Snap to presenter" is a one-shot action. Once a follower pans away, they have no persistent way to stay synced, and no visual indication they've diverged.

**Issues**:
- No visual cue when follower is out of sync with presenter
- Toggle looks like every other toggle (not prominent)
- Risk of followers drifting and losing narrative cohesion

**Recommendation**:
- Add persistent "Follow live" mode with a clear "LIVE" badge
- Show a "Return to presenter" floating pill when diverged

---

### 1.3 Duplicate Layer Controls Cause Confusion

**Problem**: Layer controls exist in TWO places:
1. **Sidebar** → basic toggles + opacity sliders
2. **LayerPanel** (floating panel on right) → detailed class toggles

**Issues**:
- Users may not discover the floating panel exists (starts collapsed)
- Same state, two control surfaces = confusion
- No clear indication these are connected

**Recommendation**: Consolidate into a single section in the sidebar with:
- Master toggle + opacity slider
- Delete the LayerPanel and integrate it inside `Sidebar`
- "Show all classes" disclosure for detailed controls
- Legend with color swatches
- "Solo class" quick action (hide all except one)

---

### 1.4 Cursor/Presence Clutter at Scale

**Problem**: Ambient cursors + names for up to 20 participants can clutter the slide and occlude tissue details.

**Recommendation**:
- Add declutter controls (presenter-only toggle)
- Idle cursor fade after 3-5 seconds of no movement
- Names-on-hover instead of always visible
- "Minimap-only presence" mode option
- Intelligent clustering when cursors are close together

*Ref: `IMPLEMENTATION_PLAN.md:150`, `IMPLEMENTATION_PLAN.md:1140`*

---

## 2. High Priority

Significant issues that affect professional perception and daily usability.

### 2.1 Session.tsx is a Monolith (1,246 lines)

**Problem**: The entire application state and UI lives in one file with 45+ `useState` calls.

**Why it matters**:
- Impossible to test individual features in isolation
- Every render re-evaluates all logic
- New developers can't understand the system
- No clear separation between concerns

**Recommendation**: Extract into composable pieces:
```tsx
<SessionProvider>          {/* Context for session state */}
  <ViewerProvider>         {/* Viewport/cursor state */}
    <SessionLayout>
      <SessionSidebar />   {/* All sidebar logic */}
      <ViewerPane />       {/* Viewer + overlays */}
    </SessionLayout>
  </ViewerProvider>
</SessionProvider>
```

---

### 2.2 Presenter Handoff Has No UX

**Problem**: Presenter is assigned to first user but there's no explicit handoff interface.

**Missing**:
- "Request control" action for followers
- Transfer confirmation dialog
- Visual indication of pending transfer
- Grace period handling when presenter disconnects

**Recommendation**:
- Add presenter menu with "Transfer to..." option
- "Request presenter" button for followers
- Confirmation dialog before transfer completes

*Ref: `IMPLEMENTATION_PLAN.md:520`, `IMPLEMENTATION_PLAN.md:553`*

---

### 2.3 Session Expiry Has No Warning

**Problem**: Fixed 4-hour session expiry with no user-facing countdown or extension controls.

**Impact**: Sessions terminate unexpectedly during long reviews.

**Recommendation**:
- Show countdown in footer bar when < 30 minutes remain
- "Extend session" action for presenter
- Warning toast at 15, 5, and 1 minute marks
- Grace period for active sessions

*Ref: `IMPLEMENTATION_PLAN.md:350`*

---

### 2.4 Cell/Tissue Classes are Hardcoded

**Problem**: `DEFAULT_CELL_CLASSES` and `DEFAULT_TISSUE_CLASSES` are statically defined in `Session.tsx` (lines 48-83).

**Why this is wrong**: The implementation plan specifies classes should come from the protobuf manifest. Hardcoding means:
- Can't support custom domain-specific models
- Colors may mismatch actual model output
- Generic names like "Class 5", "Class 6" look unprofessional

**Recommendation**: Load class definitions from overlay manifest, with sensible defaults only as fallback.

---

### 2.5 Silent Failure on Data Fetch

**Problem**: Cell overlay fetch errors are silently swallowed:
```typescript
.catch((err) => {
  if (err.name !== 'AbortError') {
    // Silently ignore network issues, 404s, etc.
  }
})
```

**Impact**: User sees nothing if overlay tiles fail to load—they'll think the system is broken.

**Recommendation**: Show subtle "Some overlay data unavailable" indicator when fetches fail, with retry option.

---

## 3. Medium Priority

Polish items that elevate the product from functional to professional.

### 3.1 Inconsistent Color Usage

**Problem**: Colors are defined in `tokens.css` but often bypassed:
```typescript
// Session.tsx line 815
style={{ backgroundColor: '#3C3C3C' }}  // Hardcoded!

// Button.tsx line 33
active:bg-red-700  // Should be var(--color-error-dark)
```

**Recommendation**: Audit and replace all hardcoded colors with design tokens.

---

### 3.2 Native Form Controls Look Unprofessional

**Problem**: Range sliders and checkboxes use browser defaults with minimal styling.

**Current appearance**:
- Sliders: Ugly blue in Chrome, gray in Firefox
- Checkboxes: Basic browser styling

**Recommendation**:
- Custom-styled slider with track, thumb, and fill
- Value tooltip on drag
- Custom checkbox with dark theme styling, check animation, focus ring
- Indeterminate state for "some selected"

---

### 3.3 Prefetch Wastes Bandwidth for Independent Viewers

**Problem**: Presenter viewport prefetch runs for all followers, even those exploring independently.

**Recommendation**: Gate prefetch behind follow mode or proximity to presenter viewport.

*Ref: `IMPLEMENTATION_PLAN.md:315`*

---

### 3.4 Bottom Footer Looks Out of Place

**Problem**: VS Code-style footer has:
- Blue section with connection icon
- Session ID truncated
- Empty right side

**Issues**:
- Takes vertical space without adding value

**Recommendation**: make it useful (zoom level, cursor coords, participant count, latency, session timer)

---

### 3.5 Error States Are Jarring

**Problem**: Error banner is solid `bg-red-600`, creating harsh visual interruption.

**Recommendation**:
- Softer error state with icon + text
- Inline with content rather than full-width banner
- Auto-dismiss with undo option where applicable

---

## 4. Low Priority

Nice-to-have enhancements that add delight and differentiation.

### 4.1 No Connection Quality Indicator

**Problem**: Users don't know if their cursor updates are delayed.

**Recommendation**: Latency indicator (like Discord's ping) in footer

---

## 5. Code Quality Issues

Specific bugs and inconsistencies to fix.

| Location | Issue | Impact | Priority |
|----------|-------|--------|----------|
| `Session.tsx:807-808` | `style={{ fontSize: '1rem' }}` inline instead of token | Inconsistent typography | Medium |
| `Session.tsx:815` | `style={{ backgroundColor: '#3C3C3C' }}` hardcoded | Should use token | Medium |
| `StatusBar.tsx:15` | `--statusbar-height: 1.5rem` but design says 48px | Height mismatch | Medium |
| `Toggle.tsx:63` | `${size === 'sm' ? 'mt-0.5' : 'mt-0.5'}` redundant | Dead code | Low |
| `LayerPanel.tsx:127` | `bg-gray-800/95` hardcoded opacity | Should be token | Low |
| `Button.tsx:33` | `active:bg-red-700` hardcoded | Should use `--color-error-dark` | Low |

---

### Gap to Premium Quality

To reach Stripe-level polish, focus on:

| Theme | Key Actions |
|-------|-------------|
| **Unify the experience** | Single location for layer controls, clear role indication, consistent styling |
| **Add feedback loops** | Toasts when things change, loading indicators, error explanations |
| **Polish interactions** | Custom-styled inputs, smooth animations, cursor presence refinement |
| **Guide users** | Onboarding, tooltips, discoverable shortcuts |
| **Build trust** | Session warnings, connection quality, error recovery |
