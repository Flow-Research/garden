# Native control prototype verification

Status: automated source and HTTP tests exist. Physical-device evidence remains required.

Use an isolated test account with two workspaces.
Use a declared HTTPS test origin with this source revision.
Do not use production task changes for the prototype.

| Journey                         | Expected result                                                                             | Required evidence                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Password sign-in                | Server identifies the current account                                                       | Actual iOS and Android sign-in receipts                        |
| Workspace selection             | Only the selected workspace appears                                                         | Two-workspace device test                                      |
| Task and run reads              | Current Garden data and managed run identity appear                                         | Device screen and server request evidence                      |
| Account change                  | Earlier private data disappears                                                             | Account-switch and late-response tests                         |
| Membership revocation           | Current refresh removes private data and blocks access                                      | Server revocation and both device receipts                     |
| Suspend and reconnect           | Host work continues and the client refreshes authority                                      | Both native lifecycle receipts                                 |
| Offline cold start              | Saved scope appears as stale with its server expiry and no automatic actions                | Process restart, device unlock, expiry, and reconnect receipts |
| Interrupted cache write         | Incomplete snapshots stay unavailable and cleanup removes prior content                     | Storage fault and logout race tests                            |
| Private draft                   | Draft remains device-local and scope-bound                                                  | Offline edit, relaunch, workspace change, and logout receipts  |
| Owned chat creation             | One explicit POST creates the owned thread, and unknown acknowledgement reconciles by reads | Real server and both native receipts                           |
| Native text chat                | Current access precedes each send, history precedes first send, and SDK text streams        | Actual SDK tests plus real server/device journeys              |
| Chat interruption               | Client disconnect does not cancel or replay, and delivery remains unconfirmed               | Interrupted stream, reconnect, and server receipts             |
| Chat authority after connection | Server refuses revoked sessions on every consequential frame                                | Server enforcement repair and adversarial native/server tests  |
| Unavailable host transport      | Controls stay unavailable without a real capability                                         | Visible state and zero mutation requests                       |
| Credential storage              | Credentials use device-secure storage and origin namespaces                                 | Device storage and logout inspection                           |
| Accessibility                   | Labels, focus, keyboard, and content work                                                   | VoiceOver and TalkBack journeys                                |

Run `pnpm --filter @garden/client test` and `pnpm --filter @garden/mobile test` for automated HTTP and controller regressions.
Run the web auth and shared-client regressions after any authentication or package-boundary change.
Record `INCONCLUSIVE` for a native user journey until its physical-device evidence exists.
