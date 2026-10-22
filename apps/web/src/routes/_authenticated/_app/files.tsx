import { createFileRoute } from '@tanstack/react-router'
import { BrainFilesPage } from '@/features/brain'
import {
  brainFileListOptions,
  brainFolderListOptions,
} from '@/features/brain/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/files')({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      brainFileListOptions(workspaceId),
      brainFolderListOptions(workspaceId),
    ]),
  component: FilesRoute,
})

/**
 * Files & Folders surface (Penpot "Files & Folders [DEV READY]"): upload
 * dropzone, folder grid with private/shared scope tabs, and recent files.
 */
function FilesRoute() {
  return <BrainFilesPage />
}
