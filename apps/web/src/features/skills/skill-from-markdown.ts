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
