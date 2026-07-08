# Beadsmith

## Product Overview

**The Pitch:** A performant, keyboard-first desktop client for managing Beadwork projects. It renders Markdown-formatted issues, utilizing a three-pane architecture fast overview and navigation.

**For:** Developers who manage Beadwork projects and require high-density, zero-latency local issue tracking.

**Device:** Desktop

**Design Direction:** Obsidian & Glow. Deep charcoal and true black surfaces, edge-lit borders, and subtle accent glows. High-density layouts prioritizing data over whitespace.

**Inspired by:** Linear, Raycast

---

## Screens

- **Issue Explorer:** High-density list view of all issues with instant filtering
- **Issue Detail:** Rich Markdown rendering pane for reading and editing issue contents
- **Command Palette:** Global modal for lightning-fast directory switching and issue jumping

---

## Key Flows

**Setup Local Directory:** Initialize the workspace

1. User is on Issue Explorer -> gets directed to "workspace switcher"
2. User clicks `Add workspace` -> input field opens
3. User pastes `/Users/dev/projects/beadwork` -> clicks `Add`
4. Issue Explorer instantly populates with issue data

**Triage Issues:** Filter and read specifics

1. User is on Issue Explorer -> clicks `Blocked` in sidebar
2. User selects `ISSUE-42` from list -> right pane updates instantly
3. Issue Detail shows rich Markdown, inline code blocks, and metadata tags

**Switch Context:** Move between projects

1. User presses `Cmd + K` -> Command Palette opens
2. User types `client-portal` -> hits `Enter`
3. Entire workspace refreshes to the new directory path

---

# Design System

## Color Palette

- **Primary:** `#FFFFFF` - Active text, primary icons, selected states
- **Background:** `#09090B` - Main application backdrop (true black)
- **Surface:** `#18181B` - Sidebar, panels, command palette
- **Text:** `#E4E4E7` - Standard body text
- **Muted:** `#71717A` - Secondary text, empty states, unselected tabs
- **Accent:** `#5E6AD2` - Focus rings, subtle glows, active indicators
- **Border:** `#27272A` - Divider lines, card outlines
- **Success:** `#10B981` - Ready status indicators
- **Danger:** `#EF4444` - Blocked status indicators

## Typography

Using **Geist** for crisp, highly-legible UI text and **Geist Mono** for technical data, avoiding generic OS defaults.

- **Headings:** Geist, 600, 16-24px
- **Body:** Geist, 400, 14px, 1.5 line-height
- **Small text:** Geist, 400, 12px
- **Code/Meta:** Geist Mono, 400, 12px
- **Buttons:** Geist, 500, 13px

**Style notes:**

- **Borders:** 1px solid `#27272A`, radius `6px` for internal elements, `12px` for modals
- **Shadows:** No generic drop shadows. Use inner borders (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.05)`) and subtle colored glows for active states (`box-shadow: 0 0 12px rgba(94, 106, 210, 0.15)`)
- **Atmosphere:** Feels like a specialized developer tool. Zero unnecessary padding.

## Design Tokens

```css
:root {
  --color-primary: #ffffff;
  --color-background: #09090b;
  --color-surface: #18181b;
  --color-text: #e4e4e7;
  --color-muted: #71717a;
  --color-accent: #5e6ad2;
  --color-border: #27272a;
  --font-primary: "Geist", sans-serif;
  --font-mono: "Geist Mono", monospace;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 12px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
}
```

---

### Issue Explorer

**Purpose:** Three-pane view for browsing and filtering local issues

**Layout:**

- Left Sidebar: 240px fixed (Issue List Views/Projects/Directories)
- Middle List: 320px fixed (Issue List + Search)
- Right Pane: Flexible remainder (Issue Detail)

**Key Elements:**

- **Directory Header:** Left sidebar top, displays current folder name, 14px bold, with chevron icon
- **Filter Tabs:** Middle pane top, `Ready` | `Blocked` | `All`, 12px font, `#71717A` unselected, `#FFFFFF` selected
- **Search Bar:** Middle pane, 32px height, `#09090B` bg, inset `Cmd+F` shortcut hint
- **Issue Card:** 64px height, full width, 1px bottom border `#27272A`

**UI States:**

- **Empty:** If workspace path added but no issues (in any Issue Status): "No issues found in this directory" in middle pane, `#71717A`, centered. If no workspace path added: "No workspace configured, please add a directory" in middle pane, `#71717A`, centered.
- **Loading:** Skeleton rows with gradient sweep (`#18181B` to `#27272A`)

**Components:**

- **Issue Card:** Title (13px, truncate 1 line), ID (12px Mono, `#71717A`), Status Dot (6px circle, Red/Green/Gray)

**Interactions:**

- **Click Issue:** Highlights background `#18181B`, loads right pane
- **Hover Issue:** Background `#18181B` with 50% opacity

**Responsive:**

- **Desktop:** 3-pane fixed layout

---

### Issue Detail

**Purpose:** Reading and reviewing rich Markdown content

**Layout:** Single scrolling view in the right-most pane of the main layout, 48px top padding, 800px max text width

**Key Elements:**

- **Breadcrumb:** Top left, `Project-ID / Issue-123`, 12px Geist Mono, `#71717A`
- **Issue Title:** 32px Geist 600, `#FFFFFF`, 24px bottom margin
- **Markdown Body:** 14px Geist, `#E4E4E7`, 1.6 line height
- **Code Blocks:** `#09090B` background, `#27272A` border, 12px Geist Mono, 16px padding

**UI States:**

- **Empty:** Giant wireframe icon, "Select an issue to view details", center aligned
- **Loading:** Pulse effect on title and paragraph skeletons

**Components:**

- **Status Badge:** Top right, 24px height, inline-flex, 6px radius, e.g., `Blocked` (red text, dark red bg `rgba(239, 68, 68, 0.1)`)

**Interactions:**

- **Hover Code Block:** Shows "Copy" icon button in top right corner
- **Scroll:** Header area gains a subtle `#18181B` blur backdrop

**Responsive:**

- **Desktop:** Fills remaining space, content horizontally centered if pane is wider than 800px

---

### Command Palette

**Purpose:** Global quick-switcher for directories and rapid issue navigation

**Layout:** Absolute centered modal, 600px width, sits over a blurred dark overlay

**Key Elements:**

- **Omnibox:** 56px height, 18px Geist, borderless, bottom border 1px `#27272A`
- **Results List:** 300px max-height scrollable area
- **Result Item:** 40px height, flex row, icon + text + shortcut hint
- **Footer:** 32px height, 12px text, `#71717A`, showing keyboard navigation hints (arrows to select, enter to confirm)

**UI States:**

- **Empty:** "No matching directories or issues"
- **Loading:** N/A (instant local search)

**Components:**

- **Result Item (Selected):** `#18181B` background, left border 2px `#5E6AD2`

**Interactions:**

- **Cmd+K:** Toggles modal visibility instantly
- **Type:** Filters list immediately with fuzzy search
- **Up/Down Arrows:** Moves selection highlight

**Responsive:**

- **Desktop:** Centered floating panel
