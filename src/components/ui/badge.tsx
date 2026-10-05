import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        {
          "border-transparent bg-red-600 text-white shadow":
            variant === "default",
          "border-transparent bg-zinc-800 text-zinc-300":
            variant === "secondary",
          "border-transparent bg-red-950 text-red-300 border-red-800":
            variant === "destructive",
          "text-zinc-300 border-zinc-700": variant === "outline",
          "border-transparent bg-emerald-950 text-emerald-300 border-emerald-800":
            variant === "success",
        },
        className
      )}
      {...props}
    />
  );
}
