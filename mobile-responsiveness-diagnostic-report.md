# Mobile Responsiveness Diagnostic Report — TikRecGUI Frontend

**Scope:** Mobile screens (< 768px width)  
**Date:** 2026-06-16  
**Method:** Static code analysis of all components and pages  

---

## 1. Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **Critical** | 3 | Tables unusable without horizontal scroll; button groups overflow; iOS input zoom |
| **High** | 4 | Page action headers don't wrap; dialog/card padding too large; Settings tabs overflow |
| **Medium** | 6 | Fixed widths without mobile fallbacks; drawer padding; player header crowding |
| **Low** | 4 | Minor spacing issues; tooltip touch interaction; font-size concerns |

**Top 3 fixes by impact:**
1. Reflow or card-ify the Recordings & Watchlist tables for mobile
2. Add `flex-wrap` and shrink action buttons on page headers
3. Ensure all inputs use `text-base` (or `text-base sm:text-sm`) to prevent iOS zoom

---

## 2. Component-Level Findings

### 2.1 `components/selia/table.tsx`
**Severity: Critical**

- **Issue:** Table cells use `px-6` padding (`@/components/selia/table.tsx:41`, `@/components/selia/table.tsx:73`). On mobile, this creates excessive horizontal width even with `overflow-x-auto`.
- **Issue:** `TableContainer` provides `overflow-x-auto`, but the table has no mobile-optimized reflow (card-style rows) or column hiding.
- **Preline recommendation:** Preline uses `responsive-tables` with `data-hs-datatable` or card-style reflow for mobile. Consider adopting Preline's `table-responsive` wrapper with `min-w-full` and hiding low-priority columns below `sm`.
- **Fix snippet:**
  ```tsx
  // Add responsive padding variants
  export function TableCell({ ...props }: React.ComponentProps<'td'>) {
    return (
      <td
        {...props}
        className={cn(
          'px-3 py-3 sm:px-6 sm:py-4', // mobile-first padding
          ...
        )}
      />
    );
  }
  ```

### 2.2 `components/selia/button.tsx`
**Severity: Medium**

- **Issue:** Button heights are reasonable (28-46px), but icon-only buttons at `xs-icon` (30px) and `sm-icon` (34px) are slightly below the 44x44px WCAG recommended touch target. They are close enough (34px is acceptable for most cases).
- **Issue:** No responsive text truncation inside buttons. Long labels in button groups will overflow.
- **Fix snippet:**
  ```tsx
  // In page usage, wrap button groups:
  <div className="flex flex-wrap items-center gap-2">
    {/* buttons */}
  </div>
  ```

### 2.3 `components/selia/dialog.tsx`
**Severity: High**

- **Issue:** `DialogPopup` uses `w-md` with `px-6` padding (`@/components/selia/dialog.tsx:46`, `@/components/selia/dialog.tsx:72`, `@/components/selia/dialog.tsx:104`). On a 375px screen, this leaves ~295px of usable content width.
- **Issue:** `DialogFooter` uses `justify-end` which on very narrow dialogs can cause button stacking without wrapping.
- **Fix snippet:**
  ```tsx
  className={cn(
    '...',
    'w-md max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-2rem)]',
    'px-4 sm:px-6', // reduce mobile padding
  )}
  ```

### 2.4 `components/selia/drawer.tsx`
**Severity: Medium**

- **Issue:** Right drawer uses `max-w-md w-full` (`@/components/selia/drawer.tsx:87`). This is acceptable for mobile (takes full width), but `px-6 pt-4.5` padding in `DrawerHeader` and `px-6 py-4.5` in `DrawerBody` is large on small screens.
- **Fix snippet:**
  ```tsx
  // DrawerHeader
  className={cn('px-4 pt-3 sm:px-6 sm:pt-4.5 flex items-center gap-3.5', className)}
  // DrawerBody
  className={cn('px-4 py-3 sm:px-6 sm:py-4.5 space-y-1.5 h-full overflow-y-auto', className)}
  ```

### 2.5 `components/selia/card.tsx`
**Severity: Medium**

- **Issue:** `CardHeader` uses `p-6` and `CardBody` uses `p-6` (`@/components/selia/card.tsx:22`, `@/components/selia/card.tsx:104`). On mobile, 24px padding consumes significant viewport width.
- **Fix snippet:**
  ```tsx
  // CardHeader
  className={cn('p-4 sm:p-6 gap-x-3.5 gap-y-2 ...')}
  // CardBody
  className={cn('p-4 sm:p-6 **:data-[slot=item]:px-4 sm:**:data-[slot=item]:px-6 ...')}
  ```

### 2.6 `components/selia/input.tsx`
**Severity: High**

- **Issue:** Input height is `h-9.5` (38px) which is fine, but pages frequently add `text-sm` class. iOS Safari zooms when focusing inputs with font-size < 16px.
- **Affected pages:** CommandPalette (`text-sm`), ChatPanel (`text-sm`), TranscriptPanel (`text-sm`), Recordings filters (`text-sm`), Watchlist search (`text-sm`), all Settings inputs.
- **Fix snippet:**
  ```tsx
  // Force base text size on mobile, allow sm on desktop
  className="text-base sm:text-sm"
  ```

### 2.7 `components/selia/select.tsx`
**Severity: Low**

- **Issue:** `SelectPopup` has `max-lg:w-(--anchor-width)` (`@/components/selia/select.tsx:179`) which constrains width on mobile. Generally okay.

### 2.8 `components/selia/tabs.tsx`
**Severity: Medium**

- **Issue:** `TabsList` uses `flex items-center` with no overflow handling (`@/components/selia/tabs.tsx:28`). With many tabs (e.g., Settings has 7), this will overflow horizontally on mobile.
- **Fix snippet:**
  ```tsx
  className={cn(
    'relative z-0 flex items-center bg-tabs p-1 rounded',
    'overflow-x-auto scrollbar-hide', // add horizontal scroll for many tabs
    ...
  )}
  ```

### 2.9 `components/selia/item.tsx`
**Severity: Low**

- **Issue:** Default direction is `row` with `gap-3`. On very narrow screens with long text + action buttons, content can get squished. However, `ItemContent` uses `min-w-0 flex-1` which helps with truncation.
- **Status:** Acceptable with current usage.

### 2.10 `components/selia/badge.tsx`
**Severity: Low**

- **Issue:** `md` size uses `h-5.5` (22px) which is small but badges are non-interactive. Interactive badges (if any) should be larger.
- **Status:** Acceptable.

---

## 3. Page-Level Findings

### 3.1 `pages/Recordings.tsx`
**Severity: Critical**

| Line | Issue |
|------|-------|
| 213-269 | Header uses `flex items-center justify-between` without `flex-wrap`. Right-side button group overflows on narrow screens. |
| 221-232 | "Stop Recording All" button has long text; no truncation handling. |
| 350-448 | Raw `<table>` with 8 columns (checkbox, User, Status, Transcript, Duration, Size, Date, Actions). No mobile reflow. Horizontal scroll required. |
| 413-443 | Action button group per row uses custom `<button>` elements (not the Button component) with `inline-flex` but no wrapping. May overflow within table cells. |
| 451-473 | Pagination uses `flex items-center justify-between px-4 py-3`. Okay, but prev/next buttons are icon-only which is fine. |

**Fix recommendation:**
- Add `flex-wrap` to the header action bar.
- For the table, either:
  - Hide less-critical columns on mobile (`hidden sm:table-cell`), or
  - Replace with a card-based list view below `sm` breakpoint (Preline's preferred pattern).

```tsx
// Header fix
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
  <div>
    <h1 className="text-2xl sm:text-3xl font-bold ...">Recordings</h1>
  </div>
  <div className="flex flex-wrap items-center gap-2">
    {/* buttons */}
  </div>
</div>

// Table column hiding example
<th scope="col" className="hidden sm:table-cell px-4 py-3 ...">Transcript</th>
<td className="hidden sm:table-cell px-4 py-3">...</td>
```

### 3.2 `pages/Watchlist.tsx`
**Severity: Critical**

| Line | Issue |
|------|-------|
| 260-379 | Header has 5 buttons in a row with `flex items-center gap-2`. No wrapping. Will definitely overflow on mobile. |
| 307-310 | "Export" and "Refresh All" buttons have text labels that are too long for narrow screens. |
| 460-591 | Raw `<table>` with 6 columns. No mobile reflow. |
| 557-586 | Action button group per row with 2-3 buttons. Uses custom styled `<button>` elements in `inline-flex` group. |
| 594-616 | Pagination same as Recordings. |
| 622-824 | User detail `Drawer` with `direction="right"`. The drawer has `max-w-md w-full` which is okay, but content inside uses large padding. |

**Fix recommendation:**
- Add `flex-wrap` to header action bar.
- Shrink button labels on mobile (icon + short text or icon-only).
- For the table, adopt the same mobile strategy as Recordings (hide columns or card reflow).
- Drawer content padding should be reduced on mobile.

### 3.3 `pages/Dashboard.tsx`
**Severity: Medium**

| Line | Issue |
|------|-------|
| 106 | Stat cards grid: `grid gap-4 md:grid-cols-2 lg:grid-cols-4` — **good**, stacks to 1 column on mobile. |
| 228 | Quick actions: `flex flex-wrap gap-3` — **good**. |
| 243 | Three-column grid: `grid gap-6 md:grid-cols-2 lg:grid-cols-3` — **good**. |
| 276-304 | Live users list uses `Item` component. Action button (Record) is fine. |
| 399 | Activity feed: `space-y-6` with `ps-6` (padding-left). Could reduce to `space-y-4 ps-4` on mobile. |

**Status:** Best responsive page in the app. Only minor spacing adjustments needed.

### 3.4 `pages/Clips.tsx`
**Severity: Low**

| Line | Issue |
|------|-------|
| 104-133 | Filter bar: `flex flex-wrap items-center gap-3` — **good**. |
| 147 | Grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6` — **good**. |
| 239-261 | Pagination: centered with text labels — **good**. |

**Status:** Well-implemented for mobile.

### 3.5 `pages/Watch.tsx`
**Severity: Low**

| Line | Issue |
|------|-------|
| 104-132 | Filter bar same pattern as Clips — **good**. |
| 146 | Grid responsive — **good**. |
| 169-192 | Pagination — **good**. |

**Status:** Well-implemented for mobile.

### 3.6 `pages/Settings.tsx`
**Severity: High**

| Line | Issue |
|------|-------|
| 31 | Uses `useMediaQuery('(min-width: 768px)')` for tab layout switching — **good pattern**. |
| 78-86 | 7 tab items. On mobile dropdown this is fine, but desktop tabs would overflow. The `TabsList` component doesn't handle overflow. |
| 100+ | Multiple `Card` components with `p-6` padding. On mobile, each card feels cramped due to large internal padding. |
| 208+ | Many form inputs with no explicit text-size class. Rely on Input component default. If default is `text-sm`, iOS will zoom. |
| 182 | `max-w-[200px]` on directory path — okay truncation, but fixed max-width without responsive variant. |

**Fix recommendation:**
- Ensure Settings inputs use `text-base sm:text-sm`.
- Reduce card padding on mobile via component change or page-level overrides.
- Verify mobile tab dropdown renders correctly (it appears to based on `useMediaQuery`).

### 3.7 `pages/Live.tsx`
**Severity: Low**

| Line | Issue |
|------|-------|
| 121 | Grid: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` — **good**. |
| 90-106 | Header uses `flex items-center justify-between` with a single title block — fine. |

**Status:** Well-implemented.

### 3.8 `pages/LivePlayer.tsx`
**Severity: Medium**

| Line | Issue |
|------|-------|
| 93-135 | Header: `flex items-center gap-2` with back button, title, stop button, chat toggle. On mobile, title gets very narrow. Chat button is `hidden lg:inline-flex` — correct. |
| 138 | Main layout: `flex gap-6` with no `flex-col` fallback. However, the sidebar chat is `hidden lg:flex`, so on mobile only the left column shows — **acceptable**. |
| 170-200 | Metadata cards: `grid gap-4 sm:grid-cols-3` — **good**. |
| 203-236 | Mobile chat tabs below player — **good pattern**. |

**Fix recommendation:**
- Add `min-w-0` to title and ensure `truncate` works properly.
- Consider `flex-wrap` on the header if more buttons are added.

### 3.9 `pages/WatchPlayer.tsx`
**Severity: Medium**

| Line | Issue |
|------|-------|
| 194-219 | Header: `flex items-center gap-2` with back button, title, transcript button, chat button. Desktop buttons correctly hidden with `hidden lg:inline-flex`. |
| 230 | Main layout: `flex gap-6` — sidebar panels are `hidden lg:flex`, so mobile only sees left column — **acceptable**. |
| 255-300 | Metadata cards: `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` — **good**. |
| 302-326 | Action buttons: `flex justify-end gap-2` — no wrapping. On mobile with 3 buttons, may overflow if labels are long. |
| 329-393 | Mobile tabs for player/transcript/chat — **excellent pattern**. |

**Fix recommendation:**
- Add `flex-wrap` to action buttons.
- Ensure title has `truncate` (it does).

### 3.10 `pages/ClipPlayer.tsx`
**Severity: Medium**

| Line | Issue |
|------|-------|
| 82-89 | Header: `flex items-center gap-2` — fine, only back + title. |
| 123-168 | Metadata cards: `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` — **good**. |
| 170-187 | Action buttons: `flex justify-end gap-2` — no wrapping. |

**Fix recommendation:**
- Add `flex-wrap` to action buttons.

---

## 4. Shared / Layout Component Findings

### 4.1 `components/Layout.tsx`
**Severity: Low**

| Line | Issue |
|------|-------|
| 88-113 | Mobile header: `fixed top-0 left-0 right-0 z-40` with `h-14`. Correct implementation. |
| 124-147 | Mobile sidebar drawer: `w-64` with `translate-x` animation. Correct. |
| 150-299 | Desktop sidebar with `miniMode`. Correctly hidden on mobile (`hidden md:flex`). |
| 302-310 | Main content: `pt-14 md:pt-0 pb-8` and `px-4 sm:px-6 lg:px-8`. **Good responsive padding.** |

**Status:** Layout is well-implemented for mobile.

### 4.2 `components/CommandPalette.tsx`
**Severity: Medium**

| Line | Issue |
|------|-------|
| 53 | `max-h-[min(27rem,50dvh)]` — good for mobile viewport. |
| 58-62 | Input uses `text-sm` and `h-9`. **iOS zoom risk.** |
| 55 | Search icon positioning uses `absolute left-5` with `pl-8` on input. Fine. |

**Fix recommendation:**
- Change input to `text-base sm:text-sm`.

### 4.3 `components/ChatPanel.tsx` & `components/TranscriptPanel.tsx`
**Severity: Medium**

| Line | Issue |
|------|-------|
| ChatPanel:80-85 | Input uses `text-sm` and `h-8`. **iOS zoom risk.** |
| ChatPanel:114 | Events list uses `font-mono text-xs`. Very small but readable. Non-interactive text is okay. |
| TranscriptPanel:84-89 | Input uses `text-sm` and `h-8`. **iOS zoom risk.** |
| TranscriptPanel:92 | Transcript text uses `font-mono text-xs` with `max-h-80 overflow-y-auto`. Acceptable. |

**Fix recommendation:**
- Change both inputs to `text-base sm:text-sm`.

### 4.4 `components/EmptyState.tsx`
**Severity: Low**

| Line | Issue |
|------|-------|
| 14-29 | `max-w-sm` card with `p-8`. On very small screens (320px), `p-8` = 64px horizontal padding, leaving ~256px for content. Acceptable but could be `p-6 sm:p-8`. |

### 4.5 `components/ClipDialog.tsx`
**Severity: Low**

| Line | Issue |
|------|-------|
| 146 | `grid grid-cols-2 gap-3` for start/end time inputs. On 320px screens, each input is ~140px wide. Acceptable but tight. |
| 174-181 | Title input with no mobile concerns. |

**Status:** Acceptable.

### 4.6 `components/recording-video-card.tsx`
**Severity: Low**

| Line | Issue |
|------|-------|
| 26-139 | Uses `motion.div` with hover/tap animations. On mobile, `whileTap` is fine but `whileHover` is irrelevant. Not a bug, but extra computation. |
| 95 | Username uses `truncate` with `min-w-0`. Good. |
| 105-129 | Action buttons use `size="icon"` with `h-8 w-8` (32px). Slightly below 44px touch target but acceptable for adjacent buttons. |

**Status:** Acceptable with minor touch-target note.

---

## 5. Preline Responsive Patterns & Recommendations

Since this project uses **Preline v4.2.0** (`preline` package), you can leverage Preline's built-in responsive utilities:

### 5.1 Preline Table Patterns
Preline recommends using `.table-responsive` wrapper with `overflow-x-auto` for data tables, or switching to **card-style rows** on mobile. Example from Preline docs:

```html
<div class="overflow-x-auto">
  <table class="min-w-full text-sm text-left">
    ...
  </table>
</div>
```

For better mobile UX, consider Preline's **list-group cards** below `sm`:

```tsx
// Below sm: show cards instead of table
<div className="sm:hidden space-y-3">
  {recordings.map((r) => (
    <Card key={r.id} className="p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">@{r.username}</span>
        <Badge variant={statusVariantMap[r.status]}>{r.status}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
        <span>{formatDuration(r.duration_seconds)}</span>
        <span>{formatBytes(r.file_size)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => handleDownload(r)}>
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="danger" onClick={() => handleDelete(r)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  ))}
</div>
<div className="hidden sm:block">
  {/* existing table */}
</div>
```

### 5.2 Preline Form Input Patterns
Preline's form inputs use `text-sm` but their CSS includes `-webkit-text-size-adjust: 100%` to prevent iOS zoom. However, the safest approach with Tailwind is explicit sizing:

```tsx
<Input className="text-base sm:text-sm" />
```

### 5.3 Preline Drawer/Modal Patterns
Preline's offcanvas/drawer components use `max-w-xs` for right-side drawers on mobile. Your `max-w-md` is fine, but consider `sm:max-w-md max-w-full` for a true full-screen mobile drawer experience.

### 5.4 Preline Button Groups
Preline uses `.btn-group` with `flex-wrap` support. Your custom button groups should adopt:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Button size="sm" variant="outline">...</Button>
  {/* etc */}
</div>
```

---

## 6. Tailwind Best Practice Fixes

### 6.1 iOS Input Zoom Prevention
**Apply globally or per-input:**

```tsx
// Option A: Global CSS in index.css
@layer base {
  input, textarea, select {
    font-size: 16px;
  }
  @media (min-width: 640px) {
    input, textarea, select {
      font-size: 14px;
    }
  }
}

// Option B: Per-component (recommended for control)
<Input className="text-base sm:text-sm" />
```

### 6.2 Responsive Padding Standard
Establish a mobile-first padding convention:

```tsx
// Card padding
className="p-4 sm:p-6"

// Dialog padding
className="px-4 py-4 sm:px-6 sm:py-4.5"

// Table cell padding
className="px-3 py-2 sm:px-4 sm:py-3"
```

### 6.3 Header Action Bar Pattern
All page headers with action buttons should follow:

```tsx
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <h1 className="text-2xl sm:text-3xl font-bold">Page Title</h1>
    <p className="text-muted-foreground mt-1">Subtitle</p>
  </div>
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline">Action</Button>
    <Button size="sm">Primary</Button>
  </div>
</div>
```

### 6.4 Table Mobile Reflow
Hide non-essential columns on mobile:

```tsx
<th className="hidden sm:table-cell">Transcript</th>
<td className="hidden sm:table-cell">...</td>
```

Or use a card-based layout below `sm` as shown in section 5.1.

---

## 7. Priority Matrix

| Priority | Issue | Location | Effort | Impact |
|----------|-------|----------|--------|--------|
| P0 | Tables overflow horizontally | Recordings.tsx, Watchlist.tsx | Medium | Critical |
| P0 | iOS input zoom | All inputs using `text-sm` | Low | Critical |
| P1 | Page header button overflow | Recordings.tsx, Watchlist.tsx | Low | High |
| P1 | Dialog/card padding too large | selia/dialog.tsx, selia/card.tsx | Low | High |
| P1 | Settings tabs overflow | Settings.tsx (TabsList) | Low | High |
| P2 | Drawer padding on mobile | selia/drawer.tsx | Low | Medium |
| P2 | Player action buttons no wrap | WatchPlayer.tsx, ClipPlayer.tsx | Low | Medium |
| P2 | Activity feed spacing | Dashboard.tsx | Low | Low |
| P3 | Tooltip touch interaction | selia/tooltip.tsx | Medium | Low |
