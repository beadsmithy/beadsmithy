---
name: Beadworker
colors:
  surface: "#18181B"
  surface-dim: "#141313"
  surface-bright: "#3a3939"
  surface-container-lowest: "#0e0e0e"
  surface-container-low: "#1c1b1b"
  surface-container: "#201f1f"
  surface-container-high: "#2a2a2a"
  surface-container-highest: "#353434"
  on-surface: "#e5e2e1"
  on-surface-variant: "#c4c7c8"
  inverse-surface: "#e5e2e1"
  inverse-on-surface: "#313030"
  outline: "#8e9192"
  outline-variant: "#444748"
  surface-tint: "#c6c6c7"
  primary: "#ffffff"
  on-primary: "#2f3131"
  primary-container: "#e2e2e2"
  on-primary-container: "#636565"
  inverse-primary: "#5d5f5f"
  secondary: "#bdc2ff"
  on-secondary: "#121f8b"
  secondary-container: "#2e3aa2"
  on-secondary-container: "#a7afff"
  tertiary: "#ffffff"
  on-tertiary: "#2f3131"
  tertiary-container: "#e2e2e2"
  on-tertiary-container: "#636565"
  error: "#ffb4ab"
  on-error: "#690005"
  error-container: "#93000a"
  on-error-container: "#ffdad6"
  primary-fixed: "#e2e2e2"
  primary-fixed-dim: "#c6c6c7"
  on-primary-fixed: "#1a1c1c"
  on-primary-fixed-variant: "#454747"
  secondary-fixed: "#dfe0ff"
  secondary-fixed-dim: "#bdc2ff"
  on-secondary-fixed: "#000965"
  on-secondary-fixed-variant: "#2e3aa2"
  tertiary-fixed: "#e2e2e2"
  tertiary-fixed-dim: "#c6c6c7"
  on-tertiary-fixed: "#1a1c1c"
  on-tertiary-fixed-variant: "#454747"
  background: "#09090B"
  on-background: "#e5e2e1"
  surface-variant: "#353434"
  text-main: "#E4E4E7"
  muted: "#71717A"
  accent: "#5E6AD2"
  border-main: "#27272A"
  success: "#10B981"
  danger: "#EF4444"
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: "600"
    lineHeight: "1.2"
    letterSpacing: -0.02em
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  button-text:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: "500"
    lineHeight: "1"
  label-mono:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: "400"
    lineHeight: 16px
    letterSpacing: 0.01em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 400px
  gap-xs: 4px
  gap-sm: 8px
  gap-md: 16px
  gap-lg: 24px
  input-height: 40px
---

## Brand & Style

The brand identity is a developer-centric, high-performance aesthetic that emphasizes precision, speed, and technical clarity. The style is a refined **Minimalist-Technical** hybrid, drawing inspiration from modern IDEs and developer tools.

It evokes a sense of "quiet power" through a monochromatic base, punctuated by a singular vibrant accent. The UI is designed to feel lightweight and responsive, utilizing subtle depth cues like inner borders and low-opacity glows rather than heavy shadows. It prioritizes content and function, providing a focused environment for technical workflows.

## Colors

The palette is anchored in a "Deep Carbon" dark mode.

- **Primary & Background:** A high-contrast relationship between pure white (#FFFFFF) for primary actions/text and a near-black zinc (#09090B) for the canvas.
- **Surface Tiers:** Surfaces use #18181B to create subtle separation from the background.
- **The Accent:** A distinctive periwinkle-blue (#5E6AD2) is used sparingly for focus states, selection highlights, and brand moments (like the logo glow).
- **Functional Colors:** Standardized semantic colors for success and danger are desaturated to maintain the professional tone.

## Typography

The typography system relies on **Geist**, a typeface designed for legibility in technical environments.

- **Headlines:** Use semi-bold weights with tight tracking to feel modern and "engineered."
- **Body:** Standardized at 14px for optimal information density.
- **Mono Space:** **Geist Mono** is used for "meta" information, hints, and code paths, reinforcing the developer-tool aesthetic.
- **Scale:** The system uses a compact scale to maximize screen real estate, avoiding overly large display type in favor of clarity.

## Layout & Spacing

The layout follows a **Fixed-Width Centered** model for utility screens, maxing out at 400px to maintain focus.

- **Vertical Rhythm:** A strict 4px/8px baseline grid is used. Sections are separated by 24px (gap-lg), while internal element groups (like labels and inputs) use 4px or 8px.
- **Utility Height:** Interactive elements like buttons and text inputs are standardized to a 40px height for a consistent, "pro" feel.
- **Responsiveness:** On mobile, the container transitions to a fluid width with 16px side margins.

## Elevation & Depth

Beadworker avoids traditional drop shadows in favor of **Tonal Layering** and **Inner Borders**.

- **Surfaces:** Depth is created by placing #18181B (Surface) cards against the #09090B (Background).
- **The "Inner Border":** Interactive elements (inputs, logo marks) use a 1px inset border or a very subtle white/0.05 opacity top-edge highlight to simulate a slight recession or "cut" into the interface.
- **Accent Glow:** High-priority brand elements (like the logo) use a soft, low-opacity #5E6AD2 glow (blur: 24px, opacity: 0.2) to create a "digital neon" effect without adding physical weight.

## Shapes

The shape language is **Soft-Square**.

- **Default:** Most components (inputs, buttons) use a 0.25rem (4px) or 0.375rem (6px) radius, providing a clean, modern look that isn't overly aggressive.
- **Larger Elements:** Container-level elements (like the logo box) may scale up to 0.75rem (12px).
- **Strictness:** Avoid "pill" shapes (full-round) except for specialized status indicators or chips.

## Components

### Buttons

- **Primary:** Background: #E4E4E7 (text-main), Text: #09090B. Hover state: #FFFFFF. This inverted high-contrast look ensures the primary action is unmistakable.
- **Ghost/Secondary:** Background: transparent, Border: #27272A, Text: #E4E4E7.

### Input Fields

- **Standard:** Background: #18181B, Border: #27272A. Focus state: Border transitions to #5E6AD2 with a 1px ring.
- **Error:** Border: #EF4444. Error text appears below in 12px Mono.

### Feedback & Loading

- **Pulse Animation:** Use a 2s ease-in-out opacity pulse (1.0 to 0.5) for loading text ("Scanning...").
- **Interactive State:** Buttons should drop to 50% opacity and use `cursor-not-allowed` when a required input is empty.

### Iconography

- Use @lucide/web icons.
- **Fill:** Use `font-variation-settings: 'FILL' 1` for active brand icons to give them more presence.
