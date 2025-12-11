import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

// Forzar renderizado dinámico para evitar caché vieja
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Si no hay usuario, aquí sí redirigimos (esto es correcto)
  if (!user) {
    return (
      <div className="p-8 text-white">
        <h1>Sesión no encontrada</h1>
        <p>No se detecta usuario logueado en el servidor.</p>
        <Link href="/auth/login"><Button>Ir al Login</Button></Link>
      </div>
    )
  }

  const profile = await getUserProfile()

  // MODO DEPURACIÓN: Si no hay perfil, NO redirigir, mostrar datos
  if (!profile) {
    return (
      <div className="min-h-screen p-8 bg-black text-white font-mono">
        <h1 className="text-2xl text-red-500 font-bold mb-4">⚠️ Error: Perfil no encontrado</h1>
        <div className="space-y-4">
            <p>El usuario existe en Auth, pero getUserProfile devolvió null.</p>
            
            <div className="p-4 border border-white/20 rounded">
                <h3 className="text-gray-400">Datos de Usuario (Auth):</h3>
                <p>ID: <span className="text-yellow-400">{user.id}</span></p>
                <p>Email: {user.email}</p>
            </div>

            <div className="p-4 border border-red-500/50 bg-red-900/10 rounded">
                <h3 className="text-red-300">Diagnóstico:</h3>
                <ul className="list-disc pl-5 space-y-2">
                    <li>Verifica que en la tabla 'profiles' exista una fila con este ID exacto.</li>
                    <li>Verifica las políticas RLS en Supabase (Profiles policies).</li>
                </ul>
            </div>
            
            <Link href="/auth/login">
                <Button variant="outline" className="mt-4">Cerrar Sesión e Intentar de nuevo</Button>
            </Link>
        </div>
      </div>
    )
  }

  // Renderizado normal si todo va bien
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <Header />

        <div className="flex justify-between items-center mb-8">
          <h1 className="heading-large text-white">Dashboard</h1>
          {profile.role === 'admin' && (
            <Link href="/admin">
              <Button variant="glass">Panel Admin</Button>
            </Link>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Bienvenido</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-white/70 mb-4">Has iniciado sesión correctamente.</p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/50">Rol:</span>
                <span className="label-uppercase text-[#FF6600] bg-[#FF6600]/10 px-3 py-1 rounded-full">
                  {profile.role}
                </span>
              </div>
              <p className="text-white/70 mt-2">{profile.full_name}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
