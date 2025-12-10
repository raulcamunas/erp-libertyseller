'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

export function LogoutButton() {
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <Button
      variant="glass"
      onClick={handleLogout}
      className="gap-2"
    >
      <LogOut className="h-4 w-4" />
      Cerrar Sesión
    </Button>
  )
}

