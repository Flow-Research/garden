import { useMemo, useState, type ReactNode } from 'react'
import { File, FileText, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import {
  FileTree as AiFileTree,
  FileTreeFile,
  FileTreeFolder,
} from '@/components/ai-elements/file-tree'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@garden/ui/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import {
  fileBasename,
  fileParentDir,
  isProtectedSkillPath,
  isValidRenameName,
  joinFilePath,
} from '../skill-file-paths'

interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children: FileTreeNode[]
}

function buildTree(filePaths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const filePath of filePaths) {
    const parts = filePath.split('/').filter(Boolean)
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      if (!name) continue
      const isLast = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      let existing = current.find((node) => node.name === name)

      if (!existing) {
        existing = {
          name,
          path,
          isDirectory: !isLast,
          children: [],
        }
        current.push(existing)
      }

      if (!isLast) current = existing.children
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((left, right) => {
      if (left.path === 'SKILL.md') return -1
      if (right.path === 'SKILL.md') return 1
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
    for (const node of nodes) {
      if (node.isDirectory) sortNodes(node.children)
    }
    return nodes
  }

  return sortNodes(root)
}

function getFileIcon(name: string) {
  if (name.endsWith('.md') || name.endsWith('.mdx')) {
    return <FileText className="size-4 text-muted-foreground" />
  }
  return <File className="size-4 text-muted-foreground" />
}

function withNodeMenu(
  node: FileTreeNode,
  row: ReactNode,
  options: {
    onSelect: (path: string) => void
    onRename?: (node: FileTreeNode) => void
    onDelete?: (path: string) => void
  },
) {
  if (!options.onRename && !options.onDelete) return row

  const protectedPath = isProtectedSkillPath(node.path)
  const stop =
    (handler: () => void) => (event: { stopPropagation: () => void }) => {
      event.stopPropagation()
      handler()
    }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) options.onSelect(node.path)
      }}
    >
      <ContextMenuTrigger render={<div className="w-full" />}>
        {row}
      </ContextMenuTrigger>
      <ContextMenuContent side="right" sideOffset={4} className="min-w-32">
        <ContextMenuItem
          disabled={protectedPath || !options.onRename}
          onClick={
            options.onRename ? stop(() => options.onRename?.(node)) : undefined
          }
        >
          <Pencil className="size-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={protectedPath || !options.onDelete}
          onClick={
            options.onDelete
              ? stop(() => options.onDelete?.(node.path))
              : undefined
          }
        >
          <Trash2 className="size-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TreeNode({
  node,
  onSelect,
  onRename,
  onDelete,
}: {
  node: FileTreeNode
  onSelect: (path: string) => void
  onRename?: (node: FileTreeNode) => void
  onDelete?: (path: string) => void
}) {
  if (node.isDirectory) {
    return (
      <FileTreeFolder
        name={node.name}
        path={node.path}
        renderRow={(row) =>
          withNodeMenu(node, row, { onSelect, onRename, onDelete })
        }
      >
        {node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </FileTreeFolder>
    )
  }

  return (
    <FileTreeFile
      name={node.name}
      path={node.path}
      icon={getFileIcon(node.name)}
      renderRow={(row) =>
        withNodeMenu(node, row, { onSelect, onRename, onDelete })
      }
    />
  )
}

function RenameNodeDialog({
  node,
  existingPaths,
  onClose,
  onRename,
}: {
  node: FileTreeNode
  existingPaths: string[]
  onClose: () => void
  onRename: (fromPath: string, toPath: string) => void
}) {
  const [name, setName] = useState(node.name)
  const nextPath = joinFilePath(fileParentDir(node.path), name)
  const unchanged = nextPath === node.path
  const invalid = !isValidRenameName(name)
  const duplicate =
    !unchanged &&
    existingPaths.some(
      (path) => path === nextPath || path.startsWith(`${nextPath}/`),
    )
  const canSubmit = !invalid && !duplicate && !unchanged

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Rename {node.isDirectory ? 'folder' : 'file'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {node.isDirectory
              ? 'Files inside this folder keep their names.'
              : `Currently ${fileBasename(node.path)}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="font-mono text-sm"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                onRename(node.path, nextPath)
                onClose()
              }
            }}
          />
          {invalid ? (
            <p className="text-xs text-destructive">Enter a name without /</p>
          ) : null}
          {duplicate ? (
            <p className="text-xs text-destructive">
              That name is already used
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => {
              onRename(node.path, nextPath)
              onClose()
            }}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FileTree({
  filePaths,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
}: {
  filePaths: string[]
  selectedPath: string
  onSelect: (path: string) => void
  onRename?: (fromPath: string, toPath: string) => void
  onDelete?: (path: string) => void
}) {
  const [renameNode, setRenameNode] = useState<FileTreeNode | null>(null)
  const tree = useMemo(() => buildTree(filePaths), [filePaths])
  const defaultExpanded = useMemo(
    () =>
      new Set(
        filePaths.flatMap((filePath) => {
          const parts = filePath.split('/').filter(Boolean)
          return parts
            .slice(0, -1)
            .map((_, index) => parts.slice(0, index + 1).join('/'))
        }),
      ),
    [filePaths],
  )

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-muted-foreground">
        <FolderOpen className="size-5 text-muted-foreground/40" />
        <p className="text-xs">No files</p>
      </div>
    )
  }

  return (
    <>
      <AiFileTree
        className="border-0 bg-transparent px-1 py-1 text-[12px]"
        defaultExpanded={defaultExpanded}
        onSelect={onSelect}
        selectedPath={selectedPath}
      >
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            onSelect={onSelect}
            onRename={onRename ? setRenameNode : undefined}
            onDelete={onDelete}
          />
        ))}
      </AiFileTree>
      {renameNode && onRename ? (
        <RenameNodeDialog
          node={renameNode}
          existingPaths={filePaths}
          onClose={() => setRenameNode(null)}
          onRename={onRename}
        />
      ) : null}
    </>
  )
}
