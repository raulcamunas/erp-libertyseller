import { AlertTriangle } from 'lucide-react'
import { redirect } from 'next/navigation'
import { PanelRendimiento } from '@/components/rendimiento/PanelRendimiento'
import { PanelRendimientoClasico } from '@/components/rendimiento/PanelRendimientoClasico'
import { CAMPOS_DEL_VINCULO, type Miembro, type VinculoVisible } from '@/components/rendimiento/tipos'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { hoyMadrid } from '@/lib/rendimiento/dia'
import { periodoDeTexto } from '@/lib/rendimiento/periodos'
import { UUID } from '@/lib/amazon/api'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * MI RENDIMIENTO.
 *
 * Cada comercial entra y ve SU panel: llamadas hechas, WhatsApp, correos, respuestas y citas de un día, una semana
 * o un mes, comparado con el periodo anterior, y el calendario de sus llamadas con las grabaciones. Quien supervisa
 * al equipo (admin, partner o el permiso suelto 'equipo-comercial') aterriza en «Todo el equipo» y puede mirar a
 * cualquier persona.
 *
 * LA DIRECCIÓN GUARDA QUIÉN Y CUÁNDO:  ?comercial=<id>&p=semana&f=2026-10-19  (sin nada: el equipo, hoy). El panel la
 * va actualizando al moverse, así que recargar o compartir enseña lo mismo.
 *
 * ESTO SOLO DECIDE QUÉ SE PINTA. Quien recorta de verdad son las políticas RLS de las tablas rinkel_* y de las
 * que se leen para las cifras (cold_lead_notes, appointments): la pantalla no filtra por comercial, así que
 * pedir el panel de otra persona sin supervisar devuelve vacío, no sus datos. El id de la URL solo se acepta si
 * es de alguien del equipo que esta persona puede ver; cualquier otro valor se ignora.
 *
 * LAS COMPARATIVAS NECESITAN LA MIGRACIÓN 235 (rendimiento_resumen_diario). Si todavía no está lanzada, la página
 * enseña el panel de un solo día de antes y avisa; desplegar el código antes que el SQL no estropea nada.
 */
export const dynamic = 'force-dynamic'

const nombreDe = (p: { full_name: string | null; email: string | null }) => p.full_name?.trim() || p.email || 'Sin nombre'
const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
      <div className="text-[13px] text-white/75 leading-relaxed">
        <p className="font-semibold text-white mb-1">{titulo}</p>
        <p>{children}</p>
      </div>
    </div>
  )
}

export default async function RendimientoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const puedeSupervisar = await puedeVerEquipoComercial(profile.role, user.id)
  const hoy = hoyMadrid()

  // El equipo que se puede elegir. Quien no supervisa solo se ve a sí mismo
  const yo = { id: user.id, nombre: nombreDe(profile) }
  const personas = new Map<string, { id: string; nombre: string }>([[yo.id, yo]])
  const comerciales = new Set<string>()
  if (puedeSupervisar) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('is_comercial', true)
      .order('full_name', { ascending: true })
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      comerciales.add(p.id)
      if (!personas.has(p.id)) personas.set(p.id, { id: p.id, nombre: nombreDe(p) })
    }
  }

  // Los vínculos con Rinkel visibles para esta sesión: el suyo, o los de todo el equipo si supervisa
  const { data: vinculosBrutos, error: errorVinculos } = await supabase.from('rinkel_vinculos').select(CAMPOS_DEL_VINCULO)
  const faltaMigracion = Boolean(errorVinculos) && isMissingSchema(errorVinculos)
  if (errorVinculos && !faltaMigracion) {
    // Un fallo de la base que no es «falta la migración» tiene que llegar a error.tsx, no esconderse como «sin Rinkel»
    console.error('Rendimiento: no se han podido leer los vínculos de Rinkel', errorVinculos)
    throw new Error('No se ha podido leer el estado de Rinkel. Recarga la página.')
  }
  const vinculosVisibles = (vinculosBrutos ?? []) as VinculoVisible[]
  const vinculos = new Map(vinculosVisibles.map((v) => [v.user_id, v]))

  // ¿Está lanzada la migración 235? Se pregunta por el día de hoy: cuesta una fila. Si falla por lo que sea, el panel de siempre
  let conComparativa = false
  if (!faltaMigracion) {
    const { error: errorResumen } = await supabase.rpc('rendimiento_resumen_diario', { p_desde: hoy, p_hasta: hoy })
    conComparativa = !errorResumen
    if (errorResumen && !isMissingSchema(errorResumen)) console.error('Rendimiento: el resumen diario ha fallado', errorResumen)
  }

  const pedido = primero(searchParams.comercial)
  const pedidoValido = puedeSupervisar && pedido && UUID.test(pedido) && personas.has(pedido) ? pedido : null

  const equipo: Miembro[] = puedeSupervisar
    ? [...personas.values()].map((p) => ({ id: p.id, nombre: p.nombre, vinculado: vinculos.has(p.id), comercial: comerciales.has(p.id) }))
    : []

  // Quien no supervisa solo está aquí si es comercial; quien supervisa puede ser un administrador que no llama
  const esComercial = !puedeSupervisar || comerciales.has(user.id)
  // Solo un administrador pone o quita la clave de Rinkel de otra persona (la ruta lo vuelve a comprobar)
  const puedeGestionar = profile.role === 'admin'

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="heading-medium text-white mb-1">{puedeSupervisar ? 'Rendimiento' : 'Mi rendimiento'}</h1>
        <p className="text-white/50 text-sm">
          {puedeSupervisar
            ? 'Cómo va el equipo y cada persona: llamadas, conversaciones, respuestas y citas, comparado con el periodo anterior. Las llamadas y sus grabaciones se leen del Rinkel de cada uno.'
            : 'Lo que has hecho: llamadas, mensajes, correos, respuestas y citas, y cómo van frente a antes. Las llamadas y sus grabaciones se leen de tu Rinkel.'}
        </p>
      </div>

      {faltaMigracion ? (
        <Aviso titulo="Falta preparar la base de datos">
          Hay que lanzar la migración <span className="font-mono text-white/90">234_rendimiento_rinkel.sql</span> en el editor SQL de Supabase. Hasta entonces este panel no
          puede guardar ni leer llamadas.
        </Aviso>
      ) : conComparativa ? (
        <PanelRendimiento
          yo={yo}
          equipo={equipo}
          puedeSupervisar={puedeSupervisar}
          puedeGestionar={puedeGestionar}
          esComercial={esComercial}
          hoy={hoy}
          vinculosIniciales={vinculosVisibles}
          personaInicial={pedidoValido}
          periodoInicial={periodoDeTexto(primero(searchParams.p), primero(searchParams.f), hoy)}
        />
      ) : (
        <>
          <Aviso titulo="Falta lanzar una migración para ver la semana, el mes y las comparativas">
            Hay que lanzar <span className="font-mono text-white/90">235_rendimiento_resumen_diario.sql</span> en el editor SQL de Supabase. Mientras tanto el panel
            enseña un día, como hasta ahora.
          </Aviso>
          <PanelRendimientoClasico
            key={pedidoValido ?? yo.id}
            usuario={pedidoValido ? personas.get(pedidoValido)! : yo}
            yo={yo.id}
            equipo={equipo}
            puedeSupervisar={puedeSupervisar}
            hoy={hoy}
            vinculoInicial={vinculos.get(pedidoValido ?? yo.id) ?? null}
            esComercial={esComercial}
            puedeGestionar={puedeGestionar}
          />
        </>
      )}
    </div>
  )
}
