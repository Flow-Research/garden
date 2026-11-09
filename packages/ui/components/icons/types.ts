import type { ComponentType, SVGProps } from 'react'

/**
 * An icon usable in a config registry. Deliberately structural rather than
 * lucide's `LucideIcon`: it accepts both lucide icons and the hand-authored
 * components in this directory, so a registry can hold a mix and icons can be
 * swapped one at a time. Typed on `SVGProps` (not just `className`) because
 * call sites pass SVG attributes through.
 */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>
