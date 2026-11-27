---
name: diagrams
description: Edit or check Garden's draw.io architecture diagrams in docs/diagrams/. Use when a change touches a path listed in docs/diagrams/manifest.json, when the PR contract asks for a diagram update, or when asked to add or change a diagram.
---

# Garden diagrams

Each diagram is one `docs/diagrams/<name>.drawio.svg` file. The file is an SVG
picture with the draw.io source embedded in its `content` attribute. GitHub and
the handbook show the picture. draw.io opens the source.

`docs/diagrams/manifest.json` maps each diagram to the code paths it shows. The
PR contract fails when a pull request changes one of those paths and neither
updates the diagram nor states `Diagrams: not affected (<name>) — <reason>`.

## Decide whether the diagram changed

1. Open `docs/diagrams/manifest.json` and find the diagrams that watch the
   files you changed.
2. Read each diagram's labels against your change. A diagram is affected when a
   box, arrow, step, or footnote no longer describes the code.
3. If no label is wrong, add one line per diagram to the PR body's
   Documentation section, such as
   `Diagrams: not affected (garden-issue-run) — renames a local variable`.
   Stop here.

## Update a diagram

1. Edit the source. A person opens the file in draw.io desktop,
   app.diagrams.net, or the VS Code Draw.io Integration extension and saves it.
   An agent decodes the `content` attribute, edits the `mxCell` `value` and
   geometry in the XML, and writes it back to a `.drawio` file.
2. Keep the existing layout and style. Change the cells your code change made
   wrong, and nothing else.
3. Set the date line to the Garden commit you checked the diagram against:
   `CHECKED AGAINST GARDEN <short sha>`.
4. Redraw the picture from the source:

   ```bash
   pnpm diagrams:export docs/diagrams/<name>.drawio.svg
   ```

   The command needs the draw.io desktop CLI (`drawio` on `PATH`, or
   `DRAWIO_BIN`). On Linux without a display it runs under `xvfb-run`.
5. Run `pnpm verify:diagrams`. It fails when the picture and the embedded
   source disagree, so an XML-only edit without an export cannot pass.
6. Commit the `.drawio.svg` in the same pull request as the code change.

## Add a diagram

1. Draw it in draw.io as one page, then export it with
   `pnpm diagrams:export <file>.drawio`.
2. Add its name, title, and watched paths to `docs/diagrams/manifest.json`.
3. Embed it in `docs/concepts/architecture/diagrams.md` with a relative image
   path and a one-sentence lead that says what it answers.
