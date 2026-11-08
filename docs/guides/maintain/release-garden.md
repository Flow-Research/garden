---
title: Release Garden
description: Gather merged pull requests, write release notes, promote dev to main, and tag the release.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-08
---

Use these steps to ship what has merged on `dev` as a numbered release on `main`. Staging deploys from `main`, so a release is also a staging deploy.

## Gather the merged pull requests

Run the gather script from a Garden checkout with `gh` signed in:

```sh
node scripts/gather-release.mjs origin/main origin/dev > release-prs.json
```

The script lists every pull request merged to `dev` that is not on `main`, with its title, body, author, and merge date. Commits with no pull request number appear under `direct`. Read each body before you describe the change.

## Write the release notes

Write the notes for teammates who do not read code. Use these sections:

1. **What's new**: group changes by product area. Open each group with what a person can now do. End each line with its pull request number and author.
2. **Fixes**: say what was broken and what works now.
3. **Before you deploy**: migrations, secrets, and third-party settings the deploy needs.
4. **Known gaps**: what does not work yet, with open issue links.
5. **What's next**: the next feature and why.

Add a short entry for the version to `CHANGELOG.md` in the same pull request.

## Open the release pull request

Open a pull request from `dev` to `main`. Put the release notes in the description and fill the pull request template. The repository owner must approve it before merge.

## Finish the release after merge

1. Confirm the staging deploy succeeded and every new migration applied.
2. Tag the merge commit on `main`:

   ```sh
   git fetch origin main
   git tag -a vX.Y.Z origin/main -m "Garden vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. Publish the GitHub release with the notes:

   ```sh
   gh release create vX.Y.Z --repo Flow-Research/garden --title "Garden vX.Y.Z" --notes-file release-notes-vX.Y.Z.md
   ```
