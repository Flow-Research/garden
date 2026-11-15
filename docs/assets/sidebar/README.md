# Collapsed sidebar tab name evidence

Captures for the collapsed-sidebar tab names in pull request #391. Same route,
viewport, and browser for every image.

| Capture | Theme | File                       | SHA-256                                                            |
| ------- | ----- | -------------------------- | ------------------------------------------------------------------ |
| Before  | Light | `sidebar-before-light.png` | `f12f7921742b592f374435ac11953ca2768150b6f37e8e3e1265c8e5a4f8defd` |
| Before  | Dark  | `sidebar-before-dark.png`  | `bf123620dd27b7f6047efe9b0c51c06f1e852d6e42e9e76e692e370fff45ee80` |
| After   | Light | `sidebar-after-light.png`  | `dc9d48fe1e716b3377afd92550bfbe3422c3deac61a74f537f2011cb28d417aa` |
| After   | Dark  | `sidebar-after-dark.png`   | `4868d098c1dc2e23e840fc1f5ba0e707c769d624fdf800c43d56cde1e827770c` |

All four are 1440×900 viewport captures at device scale factor 1 from the
authenticated local app at `http://localhost:3000`, taken with Playwright and
Google Chrome.

## Capture setup

The before images render `dev` at `c4664679`; the after images render the
feature branch at `89f86ed1`. Each capture opens `/tasks`, toggles the sidebar
to its icon rail, and hovers the Tasks tab.

The before sidebar only exposes the native `title` attribute, so the browser
draws its own tooltip outside the page and no name appears in the page capture.
The after sidebar shows its in-page tooltip immediately, in light and dark.

The stored `theme` preference selected each theme, and the capture waited for
the page, fonts, and tooltip state before screenshotting. The existing local
server was reused, the browser profile was closed, and no workspace data was
created or deleted.
