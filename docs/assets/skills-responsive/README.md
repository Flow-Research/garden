# Skills page responsive UI evidence

Before/after captures for the Skills page at desktop, tablet, and mobile widths.
All images are full-viewport Chrome captures of the authenticated local app at
`http://localhost:3000/skills?focus=d731c65b-7b3d-4c3e-a919-97a260c7c0c2` in
the `933 Labs` workspace.

| Viewport | Size     | Before commit      | After commit                                    |
| -------- | -------- | ------------------ | ----------------------------------------------- |
| Desktop  | 1440×900 | `c4664679` (`dev`) | `f85f7368` (`fix/159-skills-mobile-responsive`) |
| Tablet   | 820×1180 | `c4664679` (`dev`) | `f85f7368` (`fix/159-skills-mobile-responsive`) |
| Mobile   | 390×844  | `c4664679` (`dev`) | `f85f7368` (`fix/159-skills-mobile-responsive`) |

## Files

| Capture        | File                 | SHA-256                                                            |
| -------------- | -------------------- | ------------------------------------------------------------------ |
| Desktop before | `desktop-before.png` | `1f6661b6befda20d8abd8ee52f5c470816e3427d2b4eea3437930644427a0df6` |
| Desktop after  | `desktop-after.png`  | `f0ad8750abee04ff78abc993e4c4709f9b25cdb4d62811bd1cf477f49a982c7d` |
| Tablet before  | `tablet-before.png`  | `c626a8735b596da2012c91bac185f3e4e739ffa70d647b7a4e26310ebdc30819` |
| Tablet after   | `tablet-after.png`   | `41b1b92984766f56bae5a3eaa0f4b6b0a754d5c4d1fd4280c4839330f367d113` |
| Mobile before  | `mobile-before.png`  | `92c3419724cfd33af578bec847c8d84dc304a8c113d5e0ab18260c031b306264` |
| Mobile after   | `mobile-after.png`   | `0fddf1bb3e839ee77d6630baa305090abffb3b61dcfcd6b8682afcd975586989` |

The `dev` captures show the pre-fix two-pane layout compressed into the mobile
viewport. The feature-branch captures show the responsive list/detail split;
the mobile after capture has no horizontal overflow (`scrollWidth === 390`).
