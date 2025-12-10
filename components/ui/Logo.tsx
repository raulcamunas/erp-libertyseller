import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  width?: number
  height?: number
  showText?: boolean
}

export function Logo({ 
  className, 
  width = 200, 
  height = 50,
  showText = false 
}: LogoProps) {
  return (
    <Link href="/" className={cn("flex items-center gap-3", className)}>
      <Image
        src="/logos/logo.png"
        alt="Liberty Seller Hub"
        width={width}
        height={height}
        priority
        className="object-contain"
      />
      {showText && (
        <span className="text-white font-bold text-xl tracking-tight">
          Liberty Seller Hub
        </span>
      )}
    </Link>
  )
}

