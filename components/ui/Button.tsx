import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { twMerge } from "tailwind-merge"

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-emerald-500 text-slate-950 hover:bg-emerald-400",
        secondary: "bg-slate-700 text-slate-100 hover:bg-slate-600",
        ghost: "bg-transparent text-slate-100 hover:bg-slate-800",
        danger: "bg-red-600 text-white hover:bg-red-500",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps): JSX.Element {
  const Comp = asChild ? Slot : "button"
  return <Comp className={twMerge(buttonVariants({ variant, size }), className)} {...props} />
}
