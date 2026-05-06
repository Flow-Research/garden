'use client'

import { useMemo } from 'react'
import { File, FileText, FolderOpen } from 'lucide-react'
import {
  FileTree as AiFileTree,
  FileTreeFile,
  FileTreeFolder,
} from '@/components/ai-elements/file-tree'

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
      const name = parts[i]!
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

function TreeNode({
  node,
}: {
  node: FileTreeNode
}) {
  if (node.isDirectory) {
    return (
      <FileTreeFolder name={node.name} path={node.path}>
        {node.children.map((child) => (
          <TreeNode key={child.path} node={child} />
        ))}
      </FileTreeFolder>
    )
  }

  return (
    <FileTreeFile
      name={node.name}
      path={node.path}
      icon={getFileIcon(node.name)}
    />
  )
}

export function FileTree({
  filePaths,
  selectedPath,
  onSelect,
}: {
  filePaths: string[]
  selectedPath: string
  onSelect: (path: string) => void
}) {
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
    <AiFileTree
      className="border-0 bg-transparent px-1 py-1 text-[12px]"
      defaultExpanded={defaultExpanded}
      onSelect={onSelect}
      selectedPath={selectedPath}
    >
      {tree.map((node) => (
        <TreeNode key={node.path} node={node} />
      ))}
    </AiFileTree>
  )
}
