import { cn } from '@garden/ui/lib/utils'

type BrainFileTypeIconProps = {
  className?: string
  fileName: string
}

const FILE_TYPE_ICONS = {
  csv: { label: 'CSV', src: '/file-types/txt.svg' },
  docx: { label: 'DOC', src: '/file-types/docx.svg' },
  md: { label: 'MD', src: '/file-types/md.svg' },
  pdf: { label: 'PDF', src: '/file-types/pdf.svg' },
  txt: { label: 'TXT', src: '/file-types/txt.svg' },
  xlsx: { label: 'XLS', src: '/file-types/xlsx.svg' },
} as const

const DEFAULT_FILE_TYPE_ICON = {
  label: 'FILE',
  src: '/file-types/txt.svg',
} as const

/**
 * Resolves each supported extension to a local SVG and accessible label.
 * Local assets keep the file cards clear without a runtime icon dependency.
 */
function getBrainFileTypeIcon(fileName: string) {
  const extension = fileName.toLowerCase().split('.').pop()

  if (extension && extension in FILE_TYPE_ICONS) {
    return FILE_TYPE_ICONS[extension as keyof typeof FILE_TYPE_ICONS]
  }

  return DEFAULT_FILE_TYPE_ICON
}

/**
 * Shows the file-type SVG used in stored-file cards and upload review.
 */
export function BrainFileTypeIcon({
  className,
  fileName,
}: BrainFileTypeIconProps) {
  const icon = getBrainFileTypeIcon(fileName)

  return (
    <img
      alt={`${icon.label} file`}
      className={cn('size-9 shrink-0 object-contain', className)}
      src={icon.src}
    />
  )
}
