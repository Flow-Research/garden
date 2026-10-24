import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge taught the design token scales (tokens.css). Without them it
 * did not recognise `shadow-1`…`shadow-7`, `rounded-pill` or
 * `tracking-tightest` as shadows, radii or tracking, so an override like
 * `cn('shadow-md', 'shadow-5')` kept both classes and CSS order decided.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['1', '2', '3', '4', '5', '6', '7'],
      radius: ['pill'],
      tracking: ['tightest'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
