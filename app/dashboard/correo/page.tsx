import { redirect } from 'next/navigation'
import { PanelCorreo } from '@/components/correo/PanelCorreo'
import { UUID } from '@/lib/amazon/api'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * CORREO.
 *
 * El webmail de cada comercial dentro del ERP: conecta su buzón de Hostinger y desde aquí lee, contesta y envía, con las
 * conversaciones agrupadas en hilos y una búsqueda. Quien supervisa al equipo comercial (el administrador, o quien tenga el
 * permiso suelto «Supervisión del equipo comercial») ve además los buzones de los comerciales, en solo lectura y dejando
 * rastro de cada vez que mira uno. Un partner no entra: el middleware no le abre esta pantalla.
 *
 * LA DIRECCIÓN GUARDA DÓNDE ESTÁS:  ?buzon=<id>&hilo=<id>.
 *
 * ESTO SOLO DECIDE QUÉ SE PINTA. Las tablas correo_* están cerradas al navegador y todo pasa por las rutas de /api/correo,
 * que son las que deciden qué buzón puede abrir cada persona (lib/correo/acceso.ts). Un id de la dirección que no sea de
 * esta persona devuelve «no existe», no el buzón de otra.
 *
 * NECESITA LA MIGRACIÓN 236. Si falta, la propia pantalla lo dice con el nombre del fichero que hay que lanzar; desplegar
 * el código antes que el SQL no estropea nada.
 */
export const dynamic = 'force-dynamic'

const nombreDe = (p: { full_name: string | null; email: string | null }) => p.full_name?.trim() || p.email || 'Sin nombre'
const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const idValido = (v: string | undefined) => (v && UUID.test(v) ? v.toLowerCase() : null)

export default async function CorreoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const puedeSupervisar = await puedeVerEquipoComercial(profile.role, user.id)

  return (
    <div className="space-y-3 pb-6">
      <div>
        <h1 className="mb-0.5 text-[22px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">Correo</h1>
        <p className="max-w-3xl text-[13px] text-[var(--ls-t3)]">
          {puedeSupervisar
            ? 'Tu correo y el del equipo comercial. Los buzones del equipo se abren en solo lectura y cada vez que miras uno queda anotado.'
            : 'Tu correo de Hostinger dentro del ERP: lee, contesta y sigue cada conversación en su hilo.'}
        </p>
      </div>

      <PanelCorreo
        yo={{ id: user.id, nombre: nombreDe(profile) }}
        puedeSupervisar={puedeSupervisar}
        esAdmin={profile.role === 'admin'}
        buzonInicial={idValido(primero(searchParams.buzon))}
        hiloInicial={idValido(primero(searchParams.hilo))}
      />
    </div>
  )
}
