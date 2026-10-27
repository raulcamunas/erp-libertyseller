import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { fetchAll, fetchAllTolerante } from '@/lib/supabase/paginacion'
import { redirect } from 'next/navigation'
import { HubCrm, type CrmQualifiedAppointment } from '@/components/crm/hub/HubCrm'
import { CrmClientWithDetails } from '@/lib/types/crm'
import { WorkHourEntry, PayrollRate } from '@/lib/types/payroll'
import { CalendarPerson } from '@/lib/types/appointments'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import type { EntradaDeFase } from '@/lib/crm/fases'
import type { NotaLigera } from '@/lib/crm/lista'
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
   * QUIÉN ENTRA, Y POR QUÉ SON DOS PERMISOS Y NO UNO.
   *
   * Entra dirección (admin/partner) y entra quien supervisa al equipo comercial
   * —el permiso suelto 'equipo-comercial'—, porque el pipeline de lo que se ha
   * hablado con cada lead es lo que un manager de captación tiene que repasar.
   * Las políticas RLS de la 212 le dan lectura de crm_clients y crm_interactions,
   * más apuntar interacciones; esto solo evita el viaje. Los PDFs (crm_documents)
   * NO: ese bucket es público, así que la fila lleva la llave del fichero.
   *
   * PERO EL COSTE DEL EQUIPO NO ENTRA, y es lo que separa las dos variables de
   * abajo. Esta pantalla no solo enseña el pipeline: calcula lo que cuesta el
   * equipo comercial este mes (horas × tarifa + comisiones) y lo compara con la
   * facturación. Eso es sueldo de empleados, está fuera del encargo, y con
   * `esDireccion` a false ni se pide a la base ni se pinta.
   */
  const esDireccion = profile.role === 'admin' || profile.role === 'partner'
  const puedeEntrar =
    esDireccion || (await puedeVerEquipoComercial(profile.role, user.id))
  if (!puedeEntrar) redirect('/dashboard')

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
  const [clientsRes, teamRes, workHoursRes, payrollRatesRes, qualified, fxRes, historialRes, notasRes] =
    await Promise.all([
      supabase
        .from('crm_clients')
        .select(`
          *,
          appointment:appointments!crm_clients_appointment_id_fkey(
            *,
            comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
            assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
          )
        `)
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, full_name, email, role, calendar_color')
        .eq('is_comercial', true)
        .order('full_name', { ascending: true }),
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
      fetchAllTolerante<CrmQualifiedAppointment>('appointments cualificadas (crm)', (desde, hasta) =>
        supabase
          .from('appointments')
          .select('id, comercial_id, start_time')
          .eq('status', 'qualified')
          .eq('is_external', false)
          .order('id', { ascending: true })
          .range(desde, hasta)
      ),
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'usd_eur_rate')
        .maybeSingle(),
      // LO NUEVO DEL HUB (migración 258): el historial de fases de todos los clientes —para los días que lleva cada uno en su fase— y las notas de las reuniones, EN LIGERO.
      // De cada nota solo viaja lo justo para la lista (estado, fecha y el nivel de interés que dedujo la IA): el contenido y el desglose pesan decenas de miles de caracteres
      // y se piden al abrir la ficha. Si la migración no está lanzada, ninguna de las dos rompe la pantalla.
      leerTablaNueva<{ client_id: string } & EntradaDeFase>('historial de fases', (desde, hasta) =>
        supabase.from('crm_etapas_historial').select('client_id, etapa, desde, origen').order('id', { ascending: true }).range(desde, hasta)
      ),
      leerTablaNueva<NotaLigera>('notas de reunión', (desde, hasta) =>
        supabase.from('crm_notas_reunion').select('id, client_id, estado, fecha_reunion, interes:analisis->interes->>nivel').order('id', { ascending: true }).range(desde, hasta)
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
        puedeVerCosteEquipo={esDireccion}
        // LA OTRA MITAD DEL MISMO CORTE. La 212 le da a quien supervisa el SELECT de crm_clients y el INSERT/UPDATE de crm_interactions, y nada más: el UPDATE y el INSERT de
        // crm_clients, el DELETE de interacciones y el bucket 'crm-documents' se quedaron en is_admin_or_partner (080). Sin esto la pantalla le ofrecería seis controles que la
        // base rechaza uno por uno, y el mensaje sería siempre «No se pudo guardar», que es lo mismo que sale cuando se cae la red.
        puedeEditarFichas={esDireccion}
        historialesIniciales={historiales}
        notasIniciales={notasRes.filas}
        migracionFalta={migracionFalta}
        clienteInicial={clienteInicial}
      />
    </div>
  )
}
