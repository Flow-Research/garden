const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif)$/i

/** Product images that ship with the app or the README, not PR evidence. */
const PRODUCT_IMAGE_PATHS = ['apps/web/public/', 'docs/assets/readme/']

const UI_PATHS = [
  'apps/web/src/features/',
  'apps/web/src/routes/',
  'apps/web/src/components/',
  'packages/ui/src/',
]

const NOT_UI = [/\/routes\/api\//, /\.test\.tsx?$/, /\/-[^/]*\.test\./]

/** Folder where screenshots for one pull request must live. */
export function evidenceFolder(prNumber) {
  return `docs/assets/pr/${prNumber}/`
}

function isUiFile(file) {
  return (
    UI_PATHS.some((path) => file.startsWith(path)) &&
    !NOT_UI.some((pattern) => pattern.test(file))
  )
}

/**
 * Screenshot rules for the PR contract. Agents write most Garden PRs and
 * cannot upload images to a PR description, so screenshots are committed as
 * WebP under one folder per PR, where they stay small and easy to prune.
 */
export function evidenceFailures({ files, body, prNumber, verification }) {
  const failures = []
  const folder = evidenceFolder(prNumber)
  const images = files.filter((file) => IMAGE_FILE.test(file))

  for (const image of images) {
    if (PRODUCT_IMAGE_PATHS.some((path) => image.startsWith(path))) continue
    if (!image.startsWith(folder) || !/\.webp$/i.test(image)) {
      failures.push(
        `screenshot ${image} must be WebP in ${folder}; run: pnpm screenshot:webp ${prNumber} <files>`,
      )
    }
  }

  const uiChanged = files.some(isUiFile)
  const hasScreenshots =
    images.some((image) => image.startsWith(folder)) ||
    /!\[[^\]]*\]\([^)]+\)|<img\s/i.test(body)
  const inconclusive = /\bINCONCLUSIVE\b/.test(verification)

  if (uiChanged && !hasScreenshots && !inconclusive) {
    failures.push(
      `UI changes need screenshots: save them with pnpm screenshot:webp ${prNumber} <files> and link them under ## Verification, or mark Verification INCONCLUSIVE with the reason`,
    )
  }

  return failures
}
