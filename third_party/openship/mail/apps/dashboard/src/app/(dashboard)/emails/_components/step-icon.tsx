"use client";

import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
} from "lucide-react";
import type { MailStepStatus } from "@/lib/api";

export function StepIcon({ status }: { status: MailStepStatus["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-5 text-success" />;
    case "failed":
      return <XCircle className="size-5 text-danger" />;
    case "running":
      return <Loader2 className="size-5 text-info animate-spin" />;
    case "skipped":
      return <Circle className="size-4 text-muted-foreground/40" />;
    default:
      return <Circle className="size-4 text-muted-foreground/30" />;
  }
}
