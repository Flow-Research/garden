# Dashboard home UI evidence

Captures for the Home dashboard refresh in pull request #390. Same workspace
data, viewport, and browser for every image.

| Capture | Theme | File               | SHA-256                                                            |
| ------- | ----- | ------------------ | ------------------------------------------------------------------ |
| Before  | Light | `before-light.png` | `305736ebb47ad4cb4a4e433811c526d5f914ea955ff9c45d6e623b06dff6a37a` |
| Before  | Dark  | `before-dark.png`  | `5fb0c40708e675b87e57f825b30751b30a0ecf5812ee8db41436bb9ccd1f613a` |
| After   | Light | `after-light.png`  | `3d3cb02814c60cd369e84475fa73fa237e042d2987f3156b6bf065e04ef56344` |
| After   | Dark  | `after-dark.png`   | `7e31841d52743e308cc2bb58cb7a36c2c4a9a4a3a593996fddbf1287b5276e98`  |

All four are 1440×1330 viewport captures at device scale factor 1 from the
authenticated local app at `http://localhost:3000`, taken with Playwright and
Google Chrome. The captures use the same seeded workspace for both phases so
only the interface changes between images.

## Capture setup

The before images render `apps/web/src/features/dashboard/components/dashboard-page.tsx`
from `origin/dev` at `c4664679`. The after images render that file from
`dbd57f4f`, the pull request head before this evidence commit. Both phases used
`/home` with the stored `theme` preference set to `light` or `dark` and waited
for tasks, activity, agents, connections, and both charts to finish loading
before capture.

The isolated workspace held six issues covering every status (`todo`,
`in_progress`, `in_review`, `blocked`, `done`, `cancelled`) and every priority
(`none`, `low`, `medium`, `high`, `urgent`). The seeded issues, browser profile,
and QA session were deleted after capture. The local server was already running
and was not restarted.

Layout checks reported no horizontal page overflow, no inner scroll clipping,
and the expected resolved theme for each capture.
