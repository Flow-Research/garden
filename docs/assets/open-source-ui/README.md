# Document editor UI evidence

| Capture | File                         | SHA-256                                                            |
| ------- | ---------------------------- | ------------------------------------------------------------------ |
| Before  | `document-editor-before.png` | `5c111b60de0fb09c61d4b1fe369c469379db0c22abedbddb7c0c853435efe4f3` |
| After   | `document-editor-after.png`  | `e4239eedffbe86acdc70a106dfc01dda84577fc7ac1d29e8160133f242ad10bb` |

Both images are exact crops of authenticated 1920×1080 captures. Cropping removes
the unrelated private workspace sidebar while leaving the artifact header,
Cloudflare Workspace Docs toolbar, editable canvas, saved state, and test content
unaltered.

## Live document editor verification

The before image was captured at `1307a2c8`; the current after image was
captured at `4a8caabc` in the authenticated `Dev` workspace at 1920×1080. It
exercises the vendored Cloudflare Workspace Docs client through Garden's real
document side panel, not the retired local editor.

The before image shows a freshly imported DOCX after the iframe rendered on its
own: upstream title, `Saved` status, toolbar, and canvas begin directly below
Garden's artifact header with no spacer or overlap. For the after image, QA
uploaded a fresh DOCX through the remote Workers AI binding, invoked the actual
Underline toolbar control, hard-reloaded Garden, reopened the attachment, and
captured the persisted result. The authoritative artifact API and iframe held
the same block HTML at revision 18, the revision remained unchanged across a
2.5-second post-reload poll, and the upstream status showed `Saved`.

That run also exposed pre-reload save churn from Garden normalizing the
browser's trailing CSS semicolon. `21cc0fec` now preserves the browser-canonical
style string, covered by projection and engine round-trip tests. A later live
repeat was not counted as evidence because the local Worker rejected an
otherwise valid Better Auth session before any document was uploaded.

The temporary DOCX was registered through the same authenticated document API
used by chat (`201`). The screenshot only records the normal clickable artifact
UI.
The exact temporary Neon rows, R2 object, chat thread, auth session, browser
profile, and local server were removed after capture.
