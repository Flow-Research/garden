import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '../../lib/utils'

export interface InputProps extends React.ComponentProps<'input'> {
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  wrapperClassName?: string
}

function Input({
  className,
  type,
  leftIcon,
  rightIcon,
  wrapperClassName,
  ...props
}: InputProps) {
  return (
    <div className={cn('relative flex items-center w-full', wrapperClassName)}>
      {leftIcon && (
        <div className="absolute left-2.5 flex items-center justify-center text-muted-foreground pointer-events-none">
          {leftIcon}
        </div>
      )}

      <InputPrimitive
        type={type}
        data-slot="input"
        className={cn(
          'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
          leftIcon && 'pl-8',
          rightIcon && 'pr-8',
          className,
        )}
        {...props}
      />

      {rightIcon && (
        <div className="absolute right-2.5 flex items-center justify-center text-muted-foreground">
          {rightIcon}
        </div>
      )}
    </div>
  )
}

export { Input }