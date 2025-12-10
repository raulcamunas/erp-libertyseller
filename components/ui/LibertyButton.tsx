import * as React from "react"
import { cn } from "@/lib/utils"

export interface LibertyButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

/**
 * Componente LibertyButton que replica exactamente el estilo .submit-btn
 * del sistema de diseño Liberty Seller
 */
const LibertyButton = React.forwardRef<HTMLButtonElement, LibertyButtonProps>(
  ({ className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // Estilos base del .submit-btn
          "w-full",
          "bg-[#FF6600]",
          "text-white",
          "border-none",
          "px-4 py-4",
          "rounded-xl", // 12px = rounded-xl en Tailwind
          "font-bold", // font-weight: 700
          "text-base", // font-size: 16px
          "uppercase",
          "tracking-wide", // letter-spacing: 1px
          "cursor-pointer",
          "transition-all duration-300 ease-in-out",
          "shadow-[0_10px_20px_rgba(255,102,0,0.2)]",
          "mt-2.5", // margin-top: 10px
          // Hover states
          "hover:translate-y-[-2px]",
          "hover:shadow-[0_15px_30px_rgba(255,102,0,0.3)]",
          "hover:brightness-110",
          // Disabled states
          "disabled:opacity-70",
          "disabled:cursor-not-allowed",
          "disabled:translate-y-0",
          "disabled:hover:shadow-[0_10px_20px_rgba(255,102,0,0.2)]",
          className
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  }
)
LibertyButton.displayName = "LibertyButton"

export { LibertyButton }

