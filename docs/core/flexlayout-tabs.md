# FlexLayout Tab Styling Guide

Garden uses FlexLayout for the workspace split/tab model. FlexLayout owns tab layout through its `flexlayout__*` elements; Garden owns the tab material in `apps/web/src/custom.css` and the custom tab renderer in `apps/web/src/components/shell/workspace-dock.tsx`.

## Rules

- Treat `.flexlayout__tab_button` / `.flexlayout__tab_button_stretch` as the real tab slots. Put active tab surface, height, z-index, and main shadow there.
- Treat `.garden-flexlayout-tab__content` as content only. It should hold label layout, icon spacing, and pin state.
- Keep active and inactive tab heights equal. Do not use active-only height, font-weight, border, or padding changes; those create layout shift.
- Make the active tab surface feel connected to `.flexlayout__tab`, not like a detached pill.
- Use subtle top-only active demarcation unless there is a specific product reason. Full side borders fight the editor-tab illusion and read as cards.
- Style real FlexLayout classes from `flexlayout-react/style/alpha_light.css`; avoid copied selectors from older dock implementations.
- Suppress hardcoded tab dividers when Garden renders its own tab surfaces.

## Current Pattern

The tab shape is split across three pieces:

1. `.flexlayout__tab_button--selected` paints the active tab body.
2. `.garden-flexlayout-tab__content` lays out icon, pin indicator, and title.
3. `.flexlayout__tab` uses `--color-tab-content`, so the active tab visually belongs to the workspace surface.

Inactive tabs use `--color-tab-unselected-background`. In light mode this should stay warm and quiet, not grey. In dark mode, keep inactive tabs quieter than the active surface without disconnecting the active tab from the workspace.

## Things To Avoid

- Active-only vertical margin or font-weight changes. They cause tab jump.
- Strong inset side borders on the active tab. They make tabs read as stacked cards.
- Large outer glow. It creates a bottom chin below the active tab.
- Styling only the inner content span; FlexLayout's outer slot can still read as a rectangle.
