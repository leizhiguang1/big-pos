'use client'

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type TableActionTone = 'default' | 'primary' | 'danger'

type TableActionButtonProps = Omit<ButtonProps, 'size' | 'variant' | 'children'> & {
  label: string
  icon: LucideIcon
  tone?: TableActionTone
}

const actionToneClass: Record<TableActionTone, string> = {
  default: 'text-muted-foreground hover:border-border hover:bg-card hover:text-foreground hover:shadow-xs',
  primary: 'text-primary hover:border-primary/20 hover:bg-primary/10 hover:text-primary',
  danger: 'text-muted-foreground hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive',
}

export function TableActionButton({
  label,
  icon: Icon,
  tone = 'default',
  className,
  disabled,
  ...props
}: TableActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            disabled={disabled}
            className={cn(
              'h-8 w-8 rounded-full border border-transparent transition-all disabled:pointer-events-none disabled:opacity-40',
              actionToneClass[tone],
              className,
            )}
            {...props}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

type ActiveSwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  activeLabel?: string
  inactiveLabel?: string
  tooltip?: string
}

export function ActiveSwitch({
  checked,
  onCheckedChange,
  activeLabel = 'Active',
  inactiveLabel = 'Inactive',
  tooltip,
  className,
  disabled,
  ...props
}: ActiveSwitchProps) {
  const label = checked ? activeLabel : inactiveLabel
  const tooltipText = tooltip ?? (checked ? `Set as ${inactiveLabel.toLowerCase()}` : `Set as ${activeLabel.toLowerCase()}`)

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}: ${tooltipText}`}
      title={tooltipText}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
        checked ? 'bg-emerald-500' : 'bg-muted-foreground/30',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'h-4 w-4 rounded-full bg-white shadow-xs transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  )
}
