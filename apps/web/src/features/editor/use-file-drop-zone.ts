import { useRef, useState, type DragEvent } from 'react'

interface UseFileDropZoneOptions {
  onDrop: (files: File[]) => void
  enabled?: boolean
}

function containsFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

/**
 * Tracks nested drag targets with a depth counter so child transitions do not
 * flicker the overlay. All cleanup occurs through zone-owned drag events.
 */
function useFileDropZone({ onDrop, enabled = true }: UseFileDropZoneOptions) {
  const [draggingFiles, setDraggingFiles] = useState(false)
  const dragDepth = useRef(0)

  const resetDragState = () => {
    dragDepth.current = 0
    setDraggingFiles(false)
  }

  const dropZoneProps = {
    onDragEnter: (event: DragEvent) => {
      event.preventDefault()
      if (!enabled || !containsFiles(event)) return
      dragDepth.current += 1
      setDraggingFiles(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!enabled || !containsFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      event.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDraggingFiles(false)
    },
    onDragEnd: resetDragState,
    onDrop: (event: DragEvent) => {
      const handledByChild = event.nativeEvent.defaultPrevented
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files)
      resetDragState()
      if (enabled && !handledByChild && files.length > 0) onDrop(files)
    },
  }

  return { isDragOver: enabled && draggingFiles, dropZoneProps }
}

export { useFileDropZone }
