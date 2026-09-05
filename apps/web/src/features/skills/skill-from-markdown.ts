import { Result, TaggedError } from 'better-result'

export class SkillMarkdownError extends TaggedError('SkillMarkdownError')<{
  message: string
}>() {}

export function isMarkdownSkillFile(file: File) {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.md') ||
    name.endsWith('.mdx') ||
    file.type === 'text/markdown' ||
    file.type === 'text/x-markdown'
  )
}

/** Reads a local markdown file as-is for an empty skill editor sheet. */
export function readMarkdownFileText(file: File) {
  if (!isMarkdownSkillFile(file)) {
    return Promise.resolve(
      Result.err(
        new SkillMarkdownError({ message: 'Choose a .md or .mdx file' }),
      ),
    )
  }
  return Result.tryPromise({
    try: () => file.text(),
    catch: () =>
      new SkillMarkdownError({ message: 'Could not read that file' }),
  }).then((result) =>
    result.andThen((text) => {
      if (!text.trim()) {
        return Result.err(
          new SkillMarkdownError({ message: 'That file is empty' }),
        )
      }
      return Result.ok(text)
    }),
  )
}

/**
 * Import markdown only if the sheet is still empty after the async read.
 * `file.text()` can resolve after the user has already typed, so callers pass
 * a getter rather than a render-time snapshot.
 */
export function importMarkdownIntoEmptySheet(
  file: File,
  getSheetContent: () => string,
) {
  return Result.gen(async function* () {
    const text = yield* Result.await(readMarkdownFileText(file))
    if (getSheetContent().trim().length > 0) {
      return Result.err(
        new SkillMarkdownError({ message: 'Editor already has content' }),
      )
    }
    return Result.ok(text)
  })
}
