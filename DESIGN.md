# Cyber Pingdou UI Redesign Brief

## Product

Cyber Pingdou is a web-based pixel bead / Perler bead pattern editor. It is a single-user creative tool that runs fully in the browser. Users open the page, choose a bead board size, paint cells on a grid, select colors from bead brand palettes, undo and redo edits, save locally, export PNG/JSON, import JSON projects, import color palettes, and view color usage counts.

The redesign should make the product feel like a focused creative editor, not a marketing landing page and not a generic admin dashboard.

## Current Problem

The current interface feels cluttered and visually heavy. There are too many panels, cards, borders, shadows, and competing sections. The bead canvas should be the main focus, but the surrounding UI distracts from it. Common tasks such as choosing colors, zooming, undoing, exporting, and checking bead counts should feel faster and more direct.

The redesign should improve hierarchy, spacing, density, and interaction flow.

## Target Feel

- Calm, polished, practical, and craft-focused.
- Professional creative tool, similar in spirit to Figma, pixel editors, or pattern design software.
- Dense enough for repeated desktop use, but still readable.
- Soft neutral workspace with clear functional areas.
- The bead canvas should feel like the center of the app.
- Avoid decorative hero sections, marketing layouts, large empty cards, and excessive shadows.
- Avoid one-color themes. Use a mostly neutral interface with small accent colors from the active bead palette.

## Core Layout

Use a three-zone editor layout:

1. Left compact tool rail
   - Paint tool
   - Eraser
   - Undo
   - Redo
   - Clear canvas
   - 5x5 grid toggle
   - Canvas size controls
   - Save / export / import actions

2. Center canvas workspace
   - The bead grid is the visual focus.
   - Canvas should have ruler labels around it.
   - Canvas area should have a clean white or near-white working surface.
   - Grid lines must be readable but not harsh.
   - 5x5 guide lines should be clear and useful.
   - Zoom controls should be close to the canvas.

3. Right color panel
   - Current selected color
   - Color search
   - Brand / palette selection
   - Paginated or scrollable color swatches
   - Color cards or compact swatches that are easy to distinguish
   - Color usage counts
   - Similar colors / compare mode if space allows

## Top Bar

The top bar should be lightweight and functional:

- Project name
- Board size
- Filled bead count
- Active palette
- Zoom percentage
- Export actions

Do not make the top bar tall. It should support the canvas, not compete with it.

## Interaction Priorities

The most common user flow is:

1. Pick a color.
2. Paint cells.
3. Zoom or pan.
4. Undo / redo.
5. Check color counts.
6. Export PNG or project JSON.

These actions should be visible and easy to reach without scrolling through long panels.

## Visual Direction

- Background: light neutral gray.
- Canvas surface: white or very light gray.
- Panels: subtle borders, minimal shadows.
- Cards: use only where they represent repeated items, such as colors or usage rows.
- Buttons: compact, consistent, and tool-like.
- Inputs: restrained, not oversized.
- Color swatches: clear, large enough to identify colors, with selected state.
- Typography: clean system UI font, no oversized headings inside tool panels.
- Border radius: modest, around 6-8px.

## Avoid

- Large marketing hero sections.
- Too many separate white cards.
- Heavy drop shadows.
- Decorative blobs, gradients, or abstract background art.
- Huge headings inside side panels.
- Long vertical control stacks that force frequent scrolling.
- Text instructions inside the app explaining obvious features.
- UI that looks like a generic SaaS dashboard instead of a creative editor.

## Important Existing Features

Keep these features available:

- Canvas sizes such as 16x16, 29x29, 29x58, 32x32, 48x48, 58x58, 64x64, 87x87.
- Custom rows and columns.
- Paint and eraser tools.
- Undo and redo.
- Clear canvas.
- Optional 5x5 guide lines.
- Local browser save.
- PNG export.
- Project JSON export and import.
- Palette JSON import.
- Brand-based bead palettes.
- Color search with Chinese aliases.
- Floating or docked color panel if it remains useful.
- Color usage statistics.

## Desired Result

Create a cleaner desktop-first editor interface where the bead canvas is the main stage, the color panel is useful and efficient, and the tool controls are compact and predictable.

The final design should make users feel they can comfortably spend a long time designing bead patterns.
