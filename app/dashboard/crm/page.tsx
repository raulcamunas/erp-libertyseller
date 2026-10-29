import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { fetchAll, fetchAllTolerante } from '@/lib/supabase/paginacion'
import { redirect } from 'next/navigation'
import { HubCrm, type CrmQualifiedAppointment } from '@/components/crm/hub/HubCrm'
import { CrmClientWithDetails } from '@/lib/types/crm'
import { WorkHourEntry, PayrollRate } from '@/lib/types/payroll'
import { CalendarPerson } from '@/lib/types/appointments'
import { alcanceDelCrmDe } from '@/lib/crm/acceso-servidor'
import type { EntradaDeFase } from '@/lib/crm/fases'
import type { NotaLigera } from '@/lib/crm/lista'
import { PREFIJO_DE_DESCARTE, type ContactoLigero } from '@/lib/crm/pestanas'
import { esTablaInexistente } from '@/lib/crm/migracion'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lee una tabla NUEVA (la 258) sin que su ausencia rompa la pantalla: las migraciones de este ERP se lanzan a mano en el editor de Supabase y el código llega antes. Si la tabla
 * no existe devuelve `falta: true` y la pantalla funciona sin historial ni notas; cualquier otro fallo se registra y deja la lista vacía (como el resto de lecturas de aquí).
 */
async function leerTablaNueva<T>(etiqueta: string, build: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<{ filas: T[]; falta: boolean }> {
  try {
    return { filas: await fetchAll<T>(build), falta: false }
  } catch (error) {
    if (esTablaInexistente(error)) return { filas: [], falta: true }
    console.error(`[crm] ${etiqueta}: la consulta ha fallado, se sigue con lista vacía:`, error)
    return { filas: [], falta: false }
  }
}

export default async function CrmClientsPage({ searchParams }: { searchParams?: { cliente?: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  /**
   * QUIÉN ENTRA Y QUÉ VE: CUATRO CASOS, DECIDIDOS EN UN SOLO SITIO (lib/crm/acceso.ts).
   *
   *   · Dirección (admin/partner): todos los clientes y todo.
   *   · Un manager (el permiso suelto 'equipo-comercial'): todos los clientes; los mueve (fase, descartar, cerrar, notas) pero no toca importes, responsable ni el resultado de
   *     la cita, ni ve los PDFs de contratos (bucket público) ni el coste del equipo.
   *   · Un comercial autónomo (el permiso suelto 'crm-propios'): SOLO los clientes que lleva él (`owner_id` = él). Esta consulta ya los pide filtrados, pero el filtro de verdad
   *     es la RLS de la migración 261: aunque se escribiera a mano otra consulta en la consola del navegador, la base solo le devolvería los suyos.
   *   · Cualquier otro: no entra.
   *
   * PERO EL COSTE DEL EQUIPO NO ENTRA salvo para dirección, y es lo que separa `esDireccion` del resto. Esta pantalla no solo enseña el pipeline: calcula lo que cuesta el equipo
   * comercial este mes (horas × tarifa + comisiones) y lo compara con la facturación. Eso es sueldo de empleados, está fuera del encargo, y con `esDireccion` a false ni se pide a
   * la base ni se pinta.
   */
  const alcance = await alcanceDelCrmDe(profile.role, user.id)
  if (!alcance.entra) redirect('/dashboard')
  const esDireccion = alcance.esDireccion

  // LAS SEIS CONSULTAS VAN EN PARALELO, NO EN CADENA.
  //
  // Antes se hacía un `await` detrás de otro aunque ninguna dependa de las
  // demás: son seis GET independientes a URLs distintas de PostgREST, sin
  // estado compartido entre ellas. Medido contra la base real (tres rondas con
  // la conexión ya caliente):
  //
  //   en serie:    524 ms
  //   Promise.all: 121 ms      -> 403 ms menos, y la página es la más larga
  //                               de todo el ERP en número de consultas
  //
  // NO CAMBIA NADA DE LO QUE SE VE: cada `{ data }` se asigna exactamente a lo
  // mismo que antes, en el mismo orden, con los mismos filtros y el mismo
  // `.order()`. Y como supabase-js no lanza cuando una consulta falla —devuelve
  // `{ error }`— Promise.all tampoco altera el manejo de errores: ninguna de
  // estas seis puede rechazar la promesa.
  const [clientsRes, teamRes, workHoursRes, payrollRatesRes, qualified, fxRes, historialRes, notasRes, contactos, descartes] =
    await Promise.all([
      (() => {
        const consulta = supabase
          .from('crm_clients')
          .select(`
          *,
          appointment:appointments!crm_clients_appointment_id_fkey(
            *,
            comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
            assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
          )
        `)
          .order('created_at', { ascending: false })
        // Quien solo ve los suyos los pide ya filtrados (la RLS lo garantiza aunque esto no estuviera)
        return alcance.veTodos ? consulta : consulta.eq('owner_id', user.id)
      })(),
      // El equipo, para el responsable de cada ficha. Un comercial autónomo solo se ve a sí mismo: no tiene por qué conocer al resto del equipo
      alcance.veTodos
        ? supabase.from('profiles').select('id, full_name, email, role, calendar_color').eq('is_comercial', true).order('full_name', { ascending: true })
        : supabase.from('profiles').select('id, full_name, email, role, calendar_color').eq('id', user.id),
      // Lo necesario para calcular lo que cuesta el equipo comercial este mes.
      //
      // SOLO PARA DIRECCIÓN, Y NO ES UNA OPTIMIZACIÓN. Quien entra con el permiso
      // 'equipo-comercial' no tiene que ver lo que cobra la gente a la que
      // supervisa, así que no se le piden: se le pasa lista vacía y el hub no
      // pinta el tile «Coste comerciales» ni el desglose del mes (ver
      // `puedeVerCosteEquipo` más abajo). Pedirlas y esconderlas en el navegador
      // sería mandarle los sueldos en el HTML.
      esDireccion
        ? supabase.from('work_hours').select('*')
        : Promise.resolve({ data: [] as WorkHourEntry[] }),
      esDireccion
        ? supabase.from('payroll_rates').select('*')
        : Promise.resolve({ data: [] as PayrollRate[] }),
      // PAGINADA, igual que la misma consulta en app/dashboard/horas/page.tsx:
      // PostgREST corta a 1000 filas y NO da error. Hoy el filtro deja 3 citas
      // de las 5853 de la tabla, así que devuelve exactamente lo mismo; pero
      // con esta lista se calcula lo que cuesta el equipo comercial, y una cita
      // cualificada que cayera fuera del corte dejaría de contar en silencio.
      // El `.order('id')` es el desempate que exige paginar; no se nota porque
      // esta lista se agrupa y se cuenta, no se enseña en este orden.
      // Solo dirección: es para el coste del equipo comercial, que no se enseña a nadie más
      esDireccion
        ? fetchAllTolerante<CrmQualifiedAppointment>('appointments cualificadas (crm)', (desde, hasta) =>
            supabase
              .from('appointments')
              .select('id, comercial_id, start_time')
              .eq('status', 'qualified')
              .eq('is_external', false)
              .order('id', { ascending: true })
              .range(desde, hasta)
          )
        : Promise.resolve([] as CrmQualifiedAppointment[]),
      esDireccion ? supabase.from('app_settings').select('value').eq('key', 'usd_eur_rate').maybeSingle() : Promise.resolve({ data: null }),
      // LO NUEVO DEL HUB (migración 258): el historial de fases de todos los clientes —para los días que lleva cada uno en su fase— y las notas de las reuniones, EN LIGERO.
      // De cada nota solo viaja lo justo para la lista (estado, fecha y el nivel de interés que dedujo la IA): el contenido y el desglose pesan decenas de miles de caracteres
      // y se piden al abrir la ficha. Si la migración no está lanzada, ninguna de las dos rompe la pantalla.
      leerTablaNueva<{ client_id: string } & EntradaDeFase>('historial de fases', (desde, hasta) =>
        supabase.from('crm_etapas_historial').select('client_id, etapa, desde, origen').order('id', { ascending: true }).range(desde, hasta)
      ),
      leerTablaNueva<NotaLigera>('notas de reunión', (desde, hasta) =>
        supabase.from('crm_notas_reunion').select('id, client_id, estado, fecha_reunion, interes:analisis->interes->>nivel').neq('estado', 'ignorada').order('id', { ascending: true }).range(desde, hasta)
      ),
      // LAS TOMAS DE CONTACTO, EN LIGERO: solo de qué tipo fue y cuándo (sin el texto), para decir en «En seguimiento» cuándo fue el último contacto de cada lead. La RLS recorta lo
      // que ve cada uno (el autónomo, solo el de sus clientes)
      fetchAllTolerante<ContactoLigero>('tomas de contacto (crm)', (desde, hasta) => supabase.from('crm_interactions').select('client_id, kind, occurred_at').order('id', { ascending: true }).range(desde, hasta)),
      // Y las notas de DESCARTAR («Descartado: …»), que son pocas y llevan el motivo que se enseña en Cerrado → Perdidos. La más reciente de cada cliente gana
      fetchAllTolerante<{ client_id: string; body: string; occurred_at: string }>('motivos de descarte (crm)', (desde, hasta) =>
        supabase.from('crm_interactions').select('client_id, body, occurred_at').eq('kind', 'nota').like('body', `${PREFIJO_DE_DESCARTE}%`).order('occurred_at', { ascending: true }).range(desde, hasta)
      ),
    ])

  const clients = clientsRes.data
  const team = teamRes.data
  const workHours = workHoursRes.data
  const payrollRates = payrollRatesRes.data
  const fxSetting = fxRes.data

  const historiales: Record<string, EntradaDeFase[]> = {}
  for (const { client_id, ...entrada } of historialRes.filas) (historiales[client_id] ??= []).push(entrada)
  const migracionFalta = historialRes.falta || notasRes.falta
  // El motivo de descartar de cada cliente: la nota más reciente (vienen de la más antigua a la más reciente, así que la última pisa a las anteriores)
  const motivosDeDescarte: Record<string, string> = {}
  for (const d of descartes) motivosDeDescarte[d.client_id] = d.body

  const clienteInicial = searchParams?.cliente && UUID.test(searchParams.cliente) ? searchParams.cliente : null

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)]">
      <HubCrm
        initialClients={(clients as CrmClientWithDetails[]) || []}
        team={(team as CalendarPerson[]) || []}
        currentUser={profile}
        workHours={(workHours as WorkHourEntry[]) || []}
        payrollRates={(payrollRates as PayrollRate[]) || []}
        qualifiedAppointments={qualified}
        initialUsdEurRate={Number(fxSetting?.value ?? 0.92)}
        // QUIÉN PUEDE QUÉ, tal como lo dice la RLS (migraciones 212 y 261). Sin esto la pantalla ofrecería controles que la base rechaza uno por uno, y el mensaje sería siempre
        // «No se pudo guardar», que es lo mismo que sale cuando se cae la red.
        alcance={alcance}
        historialesIniciales={historiales}
        notasIniciales={notasRes.filas}
        contactosIniciales={contactos}
        motivosDeDescarte={motivosDeDescarte}
        migracionFalta={migracionFalta}
        clienteInicial={clienteInicial}
      />
    </div>
  )
}
