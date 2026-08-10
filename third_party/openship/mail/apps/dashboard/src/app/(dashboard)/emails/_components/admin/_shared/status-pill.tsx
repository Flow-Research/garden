"use client";

/**
 * Status pill - small rounded badge with a consistent tone palette.
 *
 * Used in every list (active/disabled mailbox, running/failed daemon,
 * primary domain, postmaster mailbox flag, etc.). One file = one source
 * of truth so we don't get five subtly different shades of "active green"
 * scattered across the admin panel.
 *
 * Tones:
 *   - success   : "active", "running", "healthy" - emerald
 *   - warning   : "starting", "stopping", "missing" - amber
 *   - danger    : "failed" - red
 *   - info      : "primary", "postmaster", "soft-delete pending" - blue
 *   - neutral   : "disabled", "stopped", "unknown" - muted
 */

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type PillTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<PillTone, string> = {
  success:
    "bg-success-bg text-success border border-success-border",
  warning:
    "bg-warning-bg text-warning border border-warning-border",
  danger:
    "bg-danger-bg text-danger border border-danger-border",
  info:
    "bg-info-bg text-info border border-info-border",
  neutral:
    "bg-muted text-muted-foreground border border-border/60",
};

interface StatusPillProps {
  tone: PillTone;
  icon?: LucideIcon;
  /** Show an animated dot before the label. Overrides icon. */
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

const DOT_CLASSES: Record<PillTone, string> = {
  success: "bg-success-solid",
  warning: "bg-warning-solid",
  danger: "bg-danger-solid",
  info: "bg-info-solid",
  neutral: "bg-muted-foreground/40",
};

export function StatusPill({
  tone,
  icon: Icon,
  dot,
  children,
  className,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot ? (
        <span className={cn("w-1.5 h-1.5 rounded-full", DOT_CLASSES[tone])} />
      ) : Icon ? (
        <Icon className="size-3" strokeWidth={2} />
      ) : null}
      {children}
    </span>
  );
}
