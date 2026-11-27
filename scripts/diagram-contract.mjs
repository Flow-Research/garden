// Anchored to the line start so the PR template's own checkbox text, which
// quotes the phrase mid-sentence, does not count as an excuse.
const EXCUSE = /^\s*(?:[-*]\s+)?diagrams:\s*not affected\b\s*[-–—:,(]?\s*(\S.*)$/im

/**
 * Return a failure for each diagram whose watched paths changed in a PR
 * without the diagram changing or the body excusing it. `manifest` is the
 * parsed docs/diagrams/manifest.json.
 */
export function diagramFailures({ files, body, manifest }) {
  if (EXCUSE.test(body)) return []

  const failures = []
  for (const [name, { watches }] of Object.entries(manifest.diagrams ?? {})) {
    const path = `docs/diagrams/${name}.drawio.svg`
    if (files.includes(path)) continue

    const matched = files.find((file) =>
      watches.some((watch) => file === watch || file.startsWith(watch)),
    )
    if (!matched) continue

    failures.push(
      `${matched} is watched by the ${name} diagram; update ${path} (pnpm diagrams:export ${path}) or add "Diagrams: not affected — <reason>" to the PR body`,
    )
  }
  return failures
}
