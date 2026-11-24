import { redirect } from 'next/navigation'
import { PreparadorDeReuniones } from '@/components/agenda/PreparadorDeReuniones'
import { getUserProfile } from '@/lib/supabase/get-user-profile'

/** El preparador de reuniones (components/agenda/PreparadorDeReuniones.tsx). La Agenda ya está protegida por el middleware; las rutas lo comprueban otra vez */
export const dynamic = 'force-dynamic'

export default async function PaginaPreparador({ searchParams }: { searchParams: { cita?: string } }) {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  const cita = typeof searchParams.cita === 'string' && /^[0-9a-f-]{36}$/i.test(searchParams.cita) ? searchParams.cita : null
  return (
    <div className="mx-auto w-full max-w-[1400px] p-3 sm:p-4">
      <PreparadorDeReuniones inicial={cita} />
    </div>
  )
}
