'use client'

import { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  File,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'

// ---------------------------------------------------------------------------
// Tree data structures
// ---------------------------------------------------------------------------

interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children: FileTreeNode[]
}

function buildTree(filePaths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const filePath of filePaths) {
    const parts = filePath.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      const isLast = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')

      let existing = current.find((n) => n.name === name)

      if (!existing) {
        existing = {
          name,
          path,
          isDirectory: !isLast,
          children: [],
        }
        current.push(existing)
      }

      if (!isLast) {
        current = existing.children
      }
    }
  }

  function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
    nodes.sort((a, b) => {
      if (a.path === 'SKILL.md') return -1
      if (b.path === 'SKILL.md') return 1
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.isDirectory) sortNodes(node.children)
    }
    return nodes
  }

  return sortNodes(root)
}

function getFileIcon(name: string) {
  if (name.endsWith('.md') || name.endsWith('.mdx')) return FileText
  return File
}

// ---------------------------------------------------------------------------
// Tree node renderer
// ---------------------------------------------------------------------------

const INDENT_PX = 10
const LEAF_OFFSET_PX = 12

function TreeNodeItem({
  node,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: FileTreeNode
  selectedPath: string
  onSelect: (path: string) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(true)
  const isSelected = node.path === selectedPath

  if (node.isDirectory) {
    const FolderIcon = expanded ? FolderOpen : Folder
    const ChevronIcon = expanded ? ChevronDown : ChevronRight

    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[12px] transition-colors hover:bg-muted/50"
          style={{ paddingLeft: `${depth * INDENT_PX + 10}px` }}
        >
          <ChevronIcon className="size-3 shrink-0 text-muted-foreground/70" />
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-foreground/80">{node.name}</span>
        </button>
        {expanded ? (
          <div>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const Icon = getFileIcon(node.name)

  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[12px] transition-colors',
        isSelected
          ? 'bg-muted font-medium text-foreground'
          : 'text-foreground/75 hover:bg-muted/50 hover:text-foreground',
      )}
      style={{
        paddingLeft: `${depth * INDENT_PX + 10 + LEAF_OFFSET_PX}px`,
      }}
    >
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          isSelected ? 'text-foreground' : 'text-muted-foreground',
        )}
      />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function FileTree({
  filePaths,
  selectedPath,
  onSelect,
}: {
  filePaths: string[]
  selectedPath: string
  onSelect: (path: string) => void
}) {
  const tree = buildTree(filePaths)

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-muted-foreground">
        <FolderOpen className="size-5 text-muted-foreground/40" />
        <p className="text-xs">No files</p>
      </div>
    )
  }

  return (
    <div className="px-1.5 py-2">
      {tree.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
