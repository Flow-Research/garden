import { mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import { evidenceFolder } from './pr-evidence.mjs'

const [prNumber, ...files] = process.argv.slice(2)

if (!/^\d+$/.test(prNumber ?? '') || files.length === 0) {
  process.stderr.write(
    'Usage: pnpm screenshot:webp <pr-number> <image> [image...]\n',
  )
  process.exit(1)
}

const folder = evidenceFolder(prNumber)
mkdirSync(folder, { recursive: true })

for (const file of files) {
  const target = join(folder, `${basename(file, extname(file))}.webp`)
  const { size } = await sharp(file).webp({ quality: 80 }).toFile(target)
  process.stdout.write(`${target} (${Math.round(size / 1024)} KB)\n`)
}

process.stdout.write(
  `Link each file under ## Verification with https://raw.githubusercontent.com/Flow-Research/garden/<head sha>/<path>\n`,
)
