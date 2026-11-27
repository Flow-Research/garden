// @vitest-environment node
import { InMemoryFs } from '@cloudflare/shell'
import { createGit } from '@cloudflare/shell/git'
import { describe, expect, it } from 'vitest'

const author = { name: 'Fixture', email: 'fixture@example.test' }

/**
 * Builds the two-commit repository from GHSA-9qw7-j9xw-fv9c in memory: `main`
 * holds `config` as a symlink that leaves the working tree, and `payload`
 * holds `config/` as a directory with one file.
 */
async function repositoryWithDirectorySymlink() {
  const fs = new InMemoryFs()
  await fs.mkdir('/repo', { recursive: true })
  await fs.mkdir('/outside', { recursive: true })
  const git = createGit(fs, '/repo')
  await git.init({ defaultBranch: 'main' })
  await fs.writeFile('/repo/readme.txt', 'base')
  await git.add({ filepath: 'readme.txt' })
  await git.commit({ message: 'base', author })

  await git.checkout({ branch: 'payload' })
  await fs.mkdir('/repo/config')
  await fs.writeFile('/repo/config/authorized_keys', 'payload')
  await git.add({ filepath: 'config/authorized_keys' })
  await git.commit({ message: 'directory', author })

  await git.checkout({ ref: 'main' })
  await fs.rm('/repo/config', { recursive: true, force: true })
  await fs.symlink('../outside', '/repo/config')
  await git.add({ filepath: 'config' })
  await git.commit({ message: 'symlink', author })
  return { fs, git }
}

describe('workspace Git checkout through the shell owner', () => {
  it('switches branches and restores tracked files', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/repo', { recursive: true })
    const git = createGit(fs, '/repo')
    await git.init({ defaultBranch: 'main' })
    await fs.writeFile('/repo/readme.txt', 'main')
    await git.add({ filepath: 'readme.txt' })
    await git.commit({ message: 'main', author })
    await git.checkout({ branch: 'feature' })
    await fs.mkdir('/repo/notes')
    await fs.writeFile('/repo/notes/plan.txt', 'feature')
    await git.add({ filepath: 'notes/plan.txt' })
    await git.commit({ message: 'feature', author })

    await git.checkout({ ref: 'main' })
    await expect(fs.exists('/repo/notes/plan.txt')).resolves.toBe(false)
    await git.checkout({ ref: 'feature' })
    await expect(fs.readFile('/repo/notes/plan.txt')).resolves.toBe('feature')
    await expect(fs.readFile('/repo/readme.txt')).resolves.toBe('main')
  })

  for (const force of [false, true]) {
    it(`refuses to write below a directory symlink (force: ${force})`, async () => {
      const { fs, git } = await repositoryWithDirectorySymlink()
      await expect(fs.lstat('/repo/config')).resolves.toMatchObject({
        type: 'symlink',
      })

      await expect(
        git.checkout({ ref: 'payload', force }),
      ).rejects.toMatchObject({
        code: 'MultipleGitError',
        errors: [{ code: 'UnsafeFilepathError' }],
      })

      await expect(fs.readdir('/outside')).resolves.toEqual([])
      await expect(fs.readlink('/repo/config')).resolves.toBe('../outside')
    })
  }
})
