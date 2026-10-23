'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Logo } from '@/components/ui/Logo'
import { useRouter } from 'next/navigation'
import { destinoTrasLogin } from '@/lib/mcp/consentimiento'
import { enviarLote, idDeSesion } from '@/lib/actividad/cliente'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Por qué se ha vuelto aquí: si es que la sesión se cerró por llevar un rato sin hacer nada (lib/actividad/inactividad.ts).
  // Se lee en un efecto y no en el primer pintado para que servidor y navegador pinten lo mismo
  const [porInactividad, setPorInactividad] = useState(false)
  useEffect(() => {
    setPorInactividad(new URLSearchParams(window.location.search).get('motivo') === 'inactividad')
  }, [])
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError

      if (data.user) {
        // Se apunta la hora del inicio de sesión (la ruta solo guarda la de los empleados y calla siempre: no cambia nada aquí)
        enviarLote(idDeSesion().id, [{ t: 'login', ruta: '/auth/login' }])
        // Si se llegó desde la pantalla de consentimiento del conector MCP, se vuelve
        // a ella; cualquier otro destino se ignora (lista cerrada, ver destinoTrasLogin).
        // Se lee de la dirección y no con useSearchParams para no obligar a esta
        // página a envolverse en Suspense.
        const siguiente = new URLSearchParams(window.location.search).get('next')
        router.push(destinoTrasLogin(siguiente))
        router.refresh()
      }
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="mb-8">
        <Logo width={200} height={60} />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="heading-medium text-white">
            Iniciar Sesión
          </CardTitle>
          <CardDescription>
            Accede a tu cuenta de Liberty Seller Hub
          </CardDescription>
        </CardHeader>
        <CardContent>
          {porInactividad && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300" role="status">
              Tu sesión se ha cerrado por llevar un rato sin actividad. Inicia sesión para seguir.
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="label-uppercase text-white/70">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="label-uppercase text-white/70">
                Contraseña
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

