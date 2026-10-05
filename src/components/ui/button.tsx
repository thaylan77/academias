import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer",
          {
            "bg-red-600 text-white hover:bg-red-700 active:scale-[0.98] shadow-sm":
              variant === "default",
            "bg-red-900/60 text-red-200 border border-red-800 hover:bg-red-900":
              variant === "destructive",
            "border border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 hover:text-white":
              variant === "outline",
            "bg-zinc-800 text-zinc-100 hover:bg-zinc-700":
              variant === "secondary",
            "hover:bg-zinc-800/80 text-zinc-300 hover:text-white":
              variant === "ghost",
            "text-red-500 underline-offset-4 hover:underline p-0 h-auto":
              variant === "link",
          },
          {
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-md px-3 text-xs": size === "sm",
            "h-12 rounded-xl px-8 text-base font-semibold": size === "lg",
            "h-10 w-10 p-0": size === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
