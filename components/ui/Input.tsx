import * as React from "react"
import { twMerge } from "tailwind-merge"

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      {...props}
      className={twMerge(
        "h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
        props.className,
      )}
    />
  )
}
