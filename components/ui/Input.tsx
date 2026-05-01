import * as React from "react"
import { twMerge } from "tailwind-merge"

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref): JSX.Element {
    return (
      <input
        ref={ref}
        {...props}
        className={twMerge(
          "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
          className,
        )}
      />
    )
  },
)
