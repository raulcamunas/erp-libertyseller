import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-bold uppercase tracking-wide transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6600] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-70",
  {
    variants: {
      variant: {
        default: "bg-[#FF6600] text-white shadow-brand hover:-translate-y-0.5 hover:shadow-brand-lg hover:brightness-110",
        glass: "bg-white/5 border border-white/10 text-white backdrop-blur-sm hover:border-[#FF6600] hover:bg-[#FF6600]/10 hover:translate-x-1",
        outline: "border border-white/15 bg-black/30 text-white hover:bg-black/50 hover:border-[#FF6600]/30 hover:shadow-[0_0_60px_rgba(255,102,0,0.2)]",
        ghost: "hover:bg-white/5 hover:text-white",
        link: "text-[#FF6600] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-6 py-4",
        sm: "h-10 px-4 text-xs",
        lg: "h-14 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

