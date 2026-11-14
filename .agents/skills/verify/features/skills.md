# Responsive Skills library

## Preconditions

- Run Garden locally in offline mode and sign in to a test workspace.
- Create skills with `metadata.category` in their frontmatter. Include a skill
  with supporting Markdown and script files, a long name, and a long description.
- Include headings, an unbroken identifier, a wide table, and a code block in
  `SKILL.md`. Leave another skill uncategorized.

## Mobile library and detail

1. Open `/skills` at widths of 320px, 390px, and 540px.
2. Confirm that the library occupies the content width and shows a continuous
   list without category chips or headings. Search by name and description,
   then clear the search after a no-match result.
3. Open a skill. Confirm that detail replaces the library and **Skills** returns
   to the same search and scroll position. Reload `?focus=<skillId>` to check
   direct navigation.
4. Switch between Preview and Source. Expand frontmatter and open each bundle
   file from the scrolling file bar. Long text must wrap; tables and code may
   scroll inside their own containers. The page must not scroll horizontally.
5. Confirm that **Edit skill** remains visible at the bottom. Edit the main
   document and return to the library. **Keep editing** retains the draft;
   **Discard changes** removes it. Repeat with a supporting file.
6. Save and reload. Read the stored skill through `GET /api/skills/<skillId>`.
   The changed document must persist and untouched supporting files must remain.
7. Add a resource, edit it, remove it, and save. Create a skill and preview a
   community import. Check that the dialogs fit a short phone viewport.
   With `notes.md` present, adding `./notes.md` must be refused, as must
   `./SKILL.md` and a path made entirely of `.` and separators. Add
   `references//./checks.md`; the tab and saved path must be
   `references/checks.md`.

## Desktop reader

1. Repeat at widths of 768px, 1024px, and 1440px.
2. Confirm that the grouped library and detail appear together, with horizontal bundle
   navigation, Preview and Source controls, Edit, and the actions menu.
   At exactly 768px, confirm that the breadcrumb/menu and view/edit controls use
   separate rows. Edit a file and check that Save wraps without overlapping
   other buttons. The special layout must not apply at 767px or 769px.
3. At 1440px, use **On this page** to jump to headings. Scroll the document and
   confirm that the active section changes. Code-fence text must not become an
   outline entry, and duplicate heading titles must have separate targets.
   Click a distant entry. Its indicator must move directly to that entry and
   stay there throughout the smooth scroll. Interrupt another jump with a wheel,
   touch gesture, or scroll key; the indicator must follow the reading position.
   With enough headings to overflow the outline, read down and back up through
   the document. The active outline entry must remain visible without moving
   the document's scroll position or shifting entries already in view.
4. Save with the keyboard shortcut. Check source sync and delete confirmations.
   A failed save retains the draft; a failed sync or delete retains its dialog.
5. Delay a save for skill A, discard its draft, and select B. Return to A and
   enter a new draft before the first save completes. Resolving that save must
   preserve the new draft and its discard guard. Save again and confirm the new
   draft persists and the unsaved indicator clears.

## Automated proof

```bash
pnpm --filter @garden/web test src/features/skills/components
```

The component tests cover navigation, filters, document modes, complete-bundle
saves, failed-write recovery, resource editing, create/import, and source sync.
The shared-client test also proves that a denied catalog read shows a retryable
error. Record local browser viewport measurements and real persisted writes
separately; jsdom cannot prove responsive layout.
