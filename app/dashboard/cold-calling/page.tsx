import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ColdCallingBoard } from '@/components/cold-calling/ColdCallingBoard'
import { EsqueletoDeCartera } from '@/components/cold-calling/EsqueletoDeCartera'
import { COOKIE_DE_PROPIETARIO, cargarCartera } from '@/lib/cold-calling/cargar'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import { getUserProfile, type UserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'
import type { CalendarPerson } from '@/lib/types/appointments'

/**
 * COLD CALLING.
 *
 * LA PÁGINA TARDABA PORQUE HACÍA TODO ANTES DE ENSEÑAR NADA: pedía los leads de TODOS los comerciales (unas 6.000 filas) en tramos de 1.000,
 * uno detrás de otro, y solo después pintaba. Ahora:
 *
 *   1. `loading.tsx` enseña el esqueleto en el mismo instante del clic.
 *   2. La página solo averigua quién es quien mira (una consulta) y devuelve la cabecera y el esqueleto; la cartera llega aparte, por
 *      streaming, dentro de <Suspense>.
 *   3. Se pide la cartera de UNA persona —la suya, o para quien supervisa la que eligió la última vez (una cookie)— con las columnas que
 *      se pintan, el primer tramo con el recuento y los demás a la vez (lib/cold-calling/cargar.ts), y la lista de comerciales en paralelo.
 *
 * QUIÉN VE LA CARTERA DE TODO EL EQUIPO Y NO SOLO LA SUYA. No es «es admin»: es admin, partner, o quien tenga el permiso suelto
 * 'equipo-comercial' —el manager de captación—. El porqué de que ese permiso exista en vez de darle el rol partner está en
 * lib/equipo-comercial/acceso.ts, en una frase: 'partner' arrastra Tesorería, Facturación, la liquidación de comisiones y los sueldos de
 * todo el equipo.
 *
 * ESTO SOLO EVITA LA PANTALLA VACÍA. Quien recorta de verdad son las políticas RLS de cold_leads y cold_lead_notes (migración 212): las
 * consultas no filtran por comercial salvo la elección de quien supervisa, y aquí no hay ninguna ruta /api de por medio que pueda comprobar
 * nada. Lo decide el servidor al pintar y la base al leer, nunca el navegador. Y NO INCLUYE REASIGNAR: la ficha no tiene control de
 * `assigned_to` y el trigger de la 212 rechaza el cambio a quien no sea admin o partner.
 */
export const dynamic = 'force-dynamic'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ColdCallingPage() {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  const puedeVerTodos = await puedeVerEquipoComercial(perfil.role, perfil.id)

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-w-0 flex-col lg:h-[calc(100vh-4rem)]">
      <Suspense fallback={<EsqueletoDeCartera />}>
        <CarteraConDatos perfil={perfil} puedeVerTodos={puedeVerTodos} />
      </Suspense>
    </div>
  )
}

async function CarteraConDatos({ perfil, puedeVerTodos }: { perfil: UserProfile; puedeVerTodos: boolean }) {
  const supabase = await createClient()

  // La elección de quien supervisa. Quien no supervisa no elige: la RLS ya le da solo la suya y un filtro de otra persona le dejaría la pantalla vacía
  const guardada = cookies().get(COOKIE_DE_PROPIETARIO)?.value
  const elegida = puedeVerTodos && guardada && (guardada === 'all' || ID.test(guardada)) ? guardada : 'all'

  const [carga, equipo] = await Promise.all([
    cargarCartera(supabase, { propietario: elegida === 'all' ? undefined : elegida }),
    puedeVerTodos ? supabase.from('profiles').select('id, full_name, email, role, calendar_color').eq('is_comercial', true).order('full_name', { ascending: true }) : Promise.resolve({ data: [] as CalendarPerson[] }),
  ])
  const team = (equipo.data as CalendarPerson[] | null) ?? []

  // Una cookie de alguien que ya no está en el equipo: se vuelve a «todos» en vez de enseñar una cartera sin dueño en el selector
  const propietario = elegida === 'all' || team.some((p) => p.id === elegida) ? elegida : 'all'
  const cartera = propietario === elegida ? carga : await cargarCartera(supabase, {})

  return <ColdCallingBoard initialLeads={cartera.leads} initialOwner={propietario} initialIncompleta={cartera.incompleta} team={team} currentUser={perfil} puedeVerTodos={puedeVerTodos} />
}
