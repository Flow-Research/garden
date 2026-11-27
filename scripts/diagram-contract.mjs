// Anchored to the line start so the PR template's own checkbox text, which
// quotes the phrase mid-sentence, does not count as an excuse.
const EXCUSE =
  /^\s*(?:[-*]\s+)?diagrams:\s*not affected\s*\(([a-z0-9-]+)\)(.*)$/i

/**
 * Names of the diagrams the PR body excuses, one per
 * `Diagrams: not affected (<name>) — <reason>` line.
 */
function excusedDiagrams(body) {
  const names = new Set()
  for (const line of body.split(/\r?\n/)) {
    const match = EXCUSE.exec(line)
    if (match && /[\p{L}\p{N}]/u.test(match[2])) names.add(match[1])
  }
  return names
}

/**
 * Return a failure for each diagram whose watched paths changed in a PR
 * without the diagram changing or the body excusing it by name. `manifest` is
 * the parsed docs/diagrams/manifest.json.
 */
export function diagramFailures({ files, body, manifest }) {
  const excused = excusedDiagrams(body)

  const failures = []
  for (const [name, { watches }] of Object.entries(manifest.diagrams ?? {})) {
    const path = `docs/diagrams/${name}.drawio.svg`
    if (files.includes(path) || excused.has(name)) continue

    const matched = files.find((file) =>
      watches.some(
        (watch) =>
          file === watch || (watch.endsWith('/') && file.startsWith(watch)),
      ),
    )
    if (!matched) continue

    failures.push(
      `${matched} is watched by the ${name} diagram; update ${path} (pnpm diagrams:export ${path}) or add "Diagrams: not affected (${name}) — <reason>" to the PR body`,
    )
  }
  return failures
}
