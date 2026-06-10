import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@garden/ui/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@garden/ui/components/ui/collapsible'
import { cn } from '@garden/ui/lib/utils'
import { ChevronsUpDownIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { createContext, useContext, useMemo } from 'react'

import { Shimmer } from './shimmer'

interface PlanContextValue {
  isStreaming: boolean
}

const PlanContext = createContext<PlanContextValue | null>(null)

const usePlan = () => {
  const context = useContext(PlanContext)
  if (!context) {
    throw new Error('Plan components must be used within Plan')
  }
  return context
}

export type PlanProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
}

export const Plan = ({
  className,
  isStreaming = false,
  children,
  ...props
}: PlanProps) => {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming])

  return (
    <PlanContext.Provider value={contextValue}>
      <Collapsible
        data-slot="plan"
        {...props}
        render={<Card className={cn('shadow-none', className)} />}
      >
        {children}
      </Collapsible>
    </PlanContext.Provider>
  )
}

export type PlanHeaderProps = ComponentProps<typeof CardHeader>

export const PlanHeader = ({ className, ...props }: PlanHeaderProps) => (
  <CardHeader
    className={cn('flex items-start justify-between', className)}
    data-slot="plan-header"
    {...props}
  />
)

export type PlanTitleProps = Omit<
  ComponentProps<typeof CardTitle>,
  'children'
> & {
  children: string
}

export const PlanTitle = ({ children, ...props }: PlanTitleProps) => {
  const { isStreaming } = usePlan()

  return (
    <CardTitle data-slot="plan-title" {...props}>
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardTitle>
  )
}

export type PlanDescriptionProps = Omit<
  ComponentProps<typeof CardDescription>,
  'children'
> & {
  children: string
}

export const PlanDescription = ({
  className,
  children,
  ...props
}: PlanDescriptionProps) => {
  const { isStreaming } = usePlan()

  return (
    <CardDescription
      className={cn('text-balance', className)}
      data-slot="plan-description"
      {...props}
    >
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardDescription>
  )
}

export type PlanActionProps = ComponentProps<typeof CardAction>

export const PlanAction = (props: PlanActionProps) => (
  <CardAction data-slot="plan-action" {...props} />
)

export type PlanContentProps = ComponentProps<typeof CardContent>

export const PlanContent = (props: PlanContentProps) => (
  <CollapsibleContent
    render={<CardContent data-slot="plan-content" {...props} />}
  ></CollapsibleContent>
)

export type PlanFooterProps = ComponentProps<'div'>

export const PlanFooter = (props: PlanFooterProps) => (
  <CardFooter data-slot="plan-footer" {...props} />
)

export type PlanTriggerProps = ComponentProps<typeof CollapsibleTrigger>

export const PlanTrigger = ({ className, ...props }: PlanTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
      className,
    )}
    data-slot="plan-trigger"
    {...props}
  >
    <ChevronsUpDownIcon className="size-4" />
    <span className="sr-only">Toggle plan</span>
  </CollapsibleTrigger>
)
