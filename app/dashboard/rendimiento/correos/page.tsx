import { redirect } from 'next/navigation'
import { PanelDeCalibracion, type Canal } from '@/components/ia-laboratorio/PanelDeCalibracion'
import { PERMISO_CONFIG_CORREOS } from '@/lib/config/apps'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * CONFIGURACIÓN DE LA IA (dentro de Mi rendimiento).
 *
 * Donde quien supervisa al equipo comercial calibra lo que escribe la IA, con un interruptor por canal:
 *   · Correo      crea versiones de las instrucciones, escribe sus propios correos de ejemplo, prueba una versión con un lead sin enviar nada y mira qué
 *                 versión consigue más respuestas. Lo usa TODO el equipo al pulsar «Redactar con IA».
 *   · WhatsApp    ajusta el mensaje que escribe la IA en el botón de WhatsApp de Cold Calling (mandos, textos, momentos, ejemplos, modelo), lo prueba con casos
 *                 de prueba o con un lead real, lo compara con el que usa el equipo y lo publica.
 *
 * La ven los administradores y quien tenga la casilla «Configuración de la IA» ('config-correos', el id no cambia) en Gestión de Usuarios.
 *
 * ESTA PÁGINA SOLO DECIDE QUIÉN LA ABRE. Quien manda de verdad es requireAppAccess en las rutas de /api/correo/laboratorio/*, porque las tablas
 * correo_ia_* y whatsapp_ia_versiones están cerradas al navegador (migraciones 242, 243 y 250).
 */
export const dynamic = 'force-dynamic'

export default async function ConfiguracionDeLaIaPage({ searchParams }: { searchParams?: { canal?: string } }) {
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

  const canal: Canal = searchParams?.canal === 'whatsapp' ? 'whatsapp' : 'correo'

  return (
    <div className="space-y-3 pb-10">
      <div>
        <h1 className="mb-0.5 text-[22px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">Configuración de la IA</h1>
        <p className="text-[13px] text-[var(--ls-t3)]">
          Calibra lo que escribe la IA: ajusta, prueba con casos sin enviar nada y publica. Lo que publiques lo usa todo el equipo comercial; las versiones anteriores se quedan en el historial.
        </p>
      </div>
      <PanelDeCalibracion canalInicial={canal} />
    </div>
  )
}
