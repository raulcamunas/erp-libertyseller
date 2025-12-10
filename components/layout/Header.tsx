import { Logo } from '@/components/ui/Logo'
import { LogoutButton } from '@/components/auth/logout-button'

export function Header() {
  return (
    <header className="glass-card border-b border-white/10 mb-8">
      <div className="max-w-7xl mx-auto px-8 py-4">
        <div className="flex justify-between items-center">
          <Logo width={180} height={50} />
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}

