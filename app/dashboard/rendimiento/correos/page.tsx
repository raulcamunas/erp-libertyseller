import { redirect } from 'next/navigation'
import { PanelLaboratorio } from '@/components/correo-laboratorio/PanelLaboratorio'
import { PERMISO_CONFIG_CORREOS } from '@/lib/config/apps'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * CONFIGURACIÓN DE CORREOS (dentro de Mi rendimiento).
 *
 * Donde quien supervisa al equipo comercial afina el correo que escribe la IA: crea versiones de las instrucciones, escribe sus propios correos
 * de ejemplo, prueba una versión con un lead sin enviar nada y mira qué versión consigue más respuestas. Lo que se cambia aquí lo usa TODO el
 * equipo al pulsar «Redactar con IA».
 *
 * La ven los administradores y quien tenga la casilla «Configuración de correos» ('config-correos') en Gestión de Usuarios.
 *
 * ESTA PÁGINA SOLO DECIDE QUIÉN LA ABRE. Quien manda de verdad es requireAppAccess en las rutas de /api/correo/laboratorio/*, porque las tablas
 * correo_ia_* están cerradas al navegador (migraciones 242 y 243).
 */
export const dynamic = 'force-dynamic'

export default async function ConfiguracionDeCorreosPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')
  if (profile.role === 'partner') redirect('/dashboard')

  if (profile.role !== 'admin') {
    const { data: permiso } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', PERMISO_CONFIG_CORREOS).maybeSingle()
    if (!permiso?.can_access) redirect('/dashboard')
  }

  return (
    <div className="space-y-3 pb-10">
      <div>
        <h1 className="mb-0.5 text-[22px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">Configuración de correos</h1>
        <p className="text-[13px] text-[var(--ls-t3)]">
          Afina el correo que escribe la IA y mira cuál convierte más: versiones de las instrucciones, tus propios correos de ejemplo, una prueba con un lead sin enviar nada y los
          resultados. Lo que cambies aquí lo usa todo el equipo comercial.
        </p>
      </div>
      <PanelLaboratorio />
    </div>
  )
}
