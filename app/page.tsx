import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/Logo'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="mb-8">
        <Logo width={250} height={80} />
      </div>
      <div className="glass-card p-12 max-w-2xl text-center">
        <h1 className="heading-large text-white mb-4">
          Liberty Seller Hub
        </h1>
        <p className="text-[#a0a0b0] text-lg mb-8">
          ERP interno - Sistema de gestión empresarial
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/auth/login">
            <Button>
              Iniciar Sesión
            </Button>
          </Link>
          <Button variant="glass">
            Más Información
          </Button>
        </div>
      </div>
    </main>
  )
}
