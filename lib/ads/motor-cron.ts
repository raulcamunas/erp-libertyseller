/**
 * AMAZON ADS · LA PARTE DEL MOTOR QUE CORRE SOLA (dentro del proceso `ads-rendimiento`, cada 2 minutos).
 * SOLO SERVIDOR.
 *
 * Por cada cuenta con el motor encendido: recoge o pide el informe de términos (una vez al día), genera las propuestas cuando hay un informe más nuevo que la última
 * generación (lo haya recogido quien lo haya recogido) y, si la cuenta está en AUTOPILOTO, aplica las negativas pendientes (hasta su tope diario). En «sugiere» y
 * «aprueba» no se aplica nada solo.
 *
 * Desde el 14 nov 2026:
 *   · una cuenta en «sugiere» o «aprueba» con negativas pendientes YA NO cuenta como trabajo (abría una fila del registro cada 2 minutos para nada: 717 al día);
 *   · generar ya no depende de que el informe lo recoja el proceso en esa misma pasada: se compara ads_terminos_sync.ultimo_ok_at con generado_at (migración 311).
 *     Sin la 311 se hace lo de antes (generar al recoger), que ahora basta porque la pantalla ya no recoge informes;
 *   · si falla la fase 3 (pujas, pausas, presupuesto) se dice en el registro, no solo en la consola.
 *
 * Desde el 15 nov 2026 (agente PPC):
 *   · `cuentasDelMotorConTrabajo` devuelve el modo de cada cuenta y la ruta se lo pasa a `pasoDelMotor` (antes no llegaba: el modo «agente» no se enteraba de nada);
 *   · en modo «agente», la fase 3 genera con los ajustes del agente (`ajustesParaPujas`: posturas, presión del día, ritmo, rampa, marca, efectos abiertos, puja máxima).
 *     Si leerlos falla, ESE DÍA no se generan pujas (se dice en el registro): sin ajustes, las reglas de siempre subirían sin los frenos del agente;
 *   · el piloto automático solo corre en «autopiloto». Lo que aplica el agente lo aplica su propio proceso (`ads-agente`, lib/ads/agente/agente-cron.ts), no este.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { cuentasASincronizar, debeEmpezar, type CuentaParaSincronizar } from './sincronizar'
import { avanzarTerminos, INTERVALO_TERMINOS_MS } from './terminos'
import { caducarPujasViejasDelMotor, generarPropuestas, leerModo, modosConMotor, pilotoAutomatico, TOPE_DIARIO_AUTOPILOTO, type ModoDelMotor, type ResumenDeGeneracion } from './motor'
import { generarPropuestasDePujaYPresupuesto } from './motor-pujas'
import { inicioDelDiaEnEspana, motorTieneTrabajo, tocaGenerar } from './motor-calculo'
import { ajustesParaPujas } from './agente/ajustes-servidor'
import { AGENTE, type AjustesDelAgenteParaPujas } from './agente/tipos'

/** null = sin comprobar; false = sin la columna generado_at (migración 311) */
let hayGeneradoAt: boolean | null = null

type FilaSync = { perfil_id: string; estado: string; pedido_at: string | null; ultimo_ok_at: string | null; error: string | null; generado_at?: string | null }

async function leerSyncs(ids: string[]): Promise<FilaSync[]> {
  const service = createServiceClient()
  if (hayGeneradoAt !== false) {
    const { data, error } = await service.from('ads_terminos_sync').select('perfil_id, estado, pedido_at, ultimo_ok_at, error, generado_at').in('perfil_id', ids)
    if (!error) {
      hayGeneradoAt = true
      return (data ?? []) as FilaSync[]
    }
    if (!isMissingSchema(error) && error.code !== '42703') throw error
    hayGeneradoAt = false
  }
  const { data, error } = await service.from('ads_terminos_sync').select('perfil_id, estado, pedido_at, ultimo_ok_at, error').in('perfil_id', ids)
  if (error) throw error
  return (data ?? []) as FilaSync[]
}

/** Una cuenta del motor con su modo (para no volver a leerlo en cada paso) */
export type CuentaDelMotor = CuentaParaSincronizar & { modo: ModoDelMotor }

/** Las cuentas con el motor encendido que ahora mismo tienen algo que hacer, con su modo. Barato: unas pocas consultas pequeñas, sin tocar Amazon */
export async function cuentasDelMotorConTrabajo(): Promise<CuentaDelMotor[]> {
  const modos = await modosConMotor()
  if (modos.size === 0) return []
  const cuentas = (await cuentasASincronizar()).filter((c) => modos.has(c.id))
  if (cuentas.length === 0) return []
  const service = createServiceClient()
  const ids = cuentas.map((c) => c.id)
  // Las pendientes y lo aplicado hoy solo importan en AUTOPILOTO (lo único que aplica solo)
  const enAutopiloto = ids.filter((id) => modos.get(id) === 'autopiloto')

  const [syncs, pendientes, aplicadasHoy] = await Promise.all([
    leerSyncs(ids),
    enAutopiloto.length === 0 ? Promise.resolve([] as Array<{ perfil_id: string }>) : service.from('ads_propuestas').select('perfil_id').in('perfil_id', enAutopiloto).eq('estado', 'pendiente').eq('tipo', 'negativizar').limit(1000).then((r) => (r.data ?? []) as Array<{ perfil_id: string }>),
    enAutopiloto.length === 0 ? Promise.resolve([] as Array<{ perfil_id: string }>) : service.from('ads_propuestas').select('perfil_id').in('perfil_id', enAutopiloto).eq('estado', 'aplicada').eq('automatica', true).gte('resuelta_at', inicioDelDiaEnEspana(Date.now())).limit(1000).then((r) => (r.data ?? []) as Array<{ perfil_id: string }>),
  ])
  const por = new Map(syncs.map((r) => [r.perfil_id, r]))
  const conPendientes = new Set(pendientes.map((r) => r.perfil_id))
  const hoyPor = new Map<string, number>()
  for (const r of aplicadasHoy) hoyPor.set(r.perfil_id, (hoyPor.get(r.perfil_id) ?? 0) + 1)
  const ahora = Date.now()
  return cuentas
    .filter((c) => {
      const e = por.get(c.id)
      return motorTieneTrabajo({
        modo: modos.get(c.id) ?? 'apagado',
        esperandoTerminos: e?.estado === 'esperando',
        tocaPedirTerminos: debeEmpezar({ ultimoOkAt: e?.ultimo_ok_at ? Date.parse(e.ultimo_ok_at) : null, pedidoAt: e?.pedido_at ? Date.parse(e.pedido_at) : null, hayError: Boolean(e?.error), ahora, forzar: false }, INTERVALO_TERMINOS_MS),
        tocaGenerar: hayGeneradoAt === true && tocaGenerar(e?.ultimo_ok_at ?? null, e?.generado_at ?? null),
        negativasPendientes: conPendientes.has(c.id),
        aplicadasHoyAuto: hoyPor.get(c.id) ?? 0,
        topeAuto: TOPE_DIARIO_AUTOPILOTO,
      })
    })
    .map((c) => ({ ...c, modo: modos.get(c.id) ?? ('apagado' as ModoDelMotor) }))
}

export interface PasoDelMotor {
  terminos: string
  /** Se han generado propuestas en este paso (aunque hayan salido 0 nuevas) */
  generado: boolean
  nuevas: number
  aplicadas: number
  fallidas: number
  /** Lo que ha fallado sin tumbar el paso (la fase 3, por ejemplo): va al resumen del registro */
  errores: string[]
}

/** Apunta cuándo se generaron las propuestas de la cuenta (sin la 311 no hay columna: no pasa nada) */
export async function marcarGenerado(perfilId: string): Promise<void> {
  if (hayGeneradoAt === false) return
  const { error } = await createServiceClient().from('ads_terminos_sync').update({ generado_at: new Date().toISOString() }).eq('perfil_id', perfilId)
  if (error && (isMissingSchema(error) || error.code === '42703' || error.code === 'PGRST204')) hayGeneradoAt = false
  else if (error) throw error
}

/** ¿Hay que generar ya? Con la 311, si el informe es más nuevo que la última generación; sin ella, si este mismo paso lo ha recogido */
async function hayQueGenerar(perfilId: string, accionDeTerminos: string): Promise<boolean> {
  if (hayGeneradoAt === null) await leerSyncs([perfilId])
  if (hayGeneradoAt === false) return accionDeTerminos === 'guardado'
  const [s] = await leerSyncs([perfilId])
  return tocaGenerar(s?.ultimo_ok_at ?? null, s?.generado_at ?? null)
}

/** Lo que necesita generarDelMotor (inyectable para las pruebas) */
export interface DependenciasDeGenerar {
  generarPropuestas: typeof generarPropuestas
  ajustesParaPujas: typeof ajustesParaPujas
  generarPropuestasDePujaYPresupuesto: typeof generarPropuestasDePujaYPresupuesto
  caducarPujasViejasDelMotor: typeof caducarPujasViejasDelMotor
  marcarGenerado: typeof marcarGenerado
}

const DEPENDENCIAS: DependenciasDeGenerar = { generarPropuestas, ajustesParaPujas, generarPropuestasDePujaYPresupuesto, caducarPujasViejasDelMotor, marcarGenerado }

export interface ResultadoDeGenerar {
  resumen: ResumenDeGeneracion
  /** Fase 3 (pujas, pausas, presupuesto); null si no se ha generado (motor apagado, sin ajustes del agente o ha fallado) */
  fase3: Awaited<ReturnType<typeof generarPropuestasDePujaYPresupuesto>> | null
  nuevas: number
  errores: string[]
}

/**
 * GENERAR (términos → propuestas; pujas, pausas y presupuesto; marcar el día como generado). Lo comparten el proceso de fondo y el botón «Generar» de la pantalla: antes el botón generaba las pujas
 * SIN los ajustes del agente en cuentas en modo agente (sin cuarentena por efecto abierto, sin la pausa con doble muestra en lanzamiento…) y además marcaba el día como generado, así que ese día
 * el proceso ya no generaba bien.
 * En modo «agente»: primero caduca las pujas y pausas pendientes del motor de otra generación (se recalculan ahora con la ventana de hoy) y después lee los ajustes; si fallan, hoy no hay pujas
 * (sin ellos subirían sin los frenos del agente) y se dice en `errores`.
 */
export async function generarDelMotor(cuenta: CuentaParaSincronizar, modo: ModoDelMotor, deps: DependenciasDeGenerar = DEPENDENCIAS): Promise<ResultadoDeGenerar> {
  const errores: string[] = []
  const resumen = await deps.generarPropuestas(cuenta)
  let nuevas = resumen.nuevas
  // Lo que la generación no ha podido hacer (p. ej. cosechar sin la lista entera de segmentaciones de los destinos) queda en el registro de la pasada
  for (const a of resumen.avisos ?? []) errores.push(`generar: ${a.slice(0, 160)}`)
  if (resumen.omitido === 'apagado') return { resumen, fase3: null, nuevas, errores }
  let ajustes: AjustesDelAgenteParaPujas | undefined
  let sinPujasHoy = false
  if (modo === 'agente') {
    // Las de otra generación fuera ANTES de generar (si no, siguen bloqueando su segmentación y se aplicarían con métricas viejas). Si falla, se sigue: decidirPropuesta las caduca igual a las 36 h
    try {
      await deps.caducarPujasViejasDelMotor(cuenta.id, AGENTE.PROPUESTA_PUJA_CADUCA_HORAS)
    } catch (e) {
      const texto = e instanceof Error ? e.message : String(e)
      console.error(`[ads] caducar pujas viejas de ${cuenta.id}:`, texto)
      errores.push(`agente: no se han podido caducar las pujas de otra generación (${texto.slice(0, 120)})`)
    }
    try {
      ajustes = await deps.ajustesParaPujas(cuenta.id, Date.now())
    } catch (e) {
      const texto = e instanceof Error ? e.message : String(e)
      console.error(`[ads] ajustes del agente de ${cuenta.id}:`, texto)
      errores.push(`agente: sin ajustes, hoy no se proponen pujas (${texto.slice(0, 120)})`)
      sinPujasHoy = true
    }
  }
  // Fase 3: pujas y presupuesto, con la misma cadencia diaria. Si falla, lo de arriba ya está guardado y se dice en el registro
  let fase3: ResultadoDeGenerar['fase3'] = null
  if (!sinPujasHoy) {
    try {
      fase3 = await deps.generarPropuestasDePujaYPresupuesto(cuenta, ajustes)
      nuevas += fase3.pujas + fase3.presupuestos + fase3.pausas
      // Omitida por datos sin releer: no es un «no había nada que hacer», se dice
      if (fase3.omitido?.startsWith('segmentaciones')) errores.push(`pujas: ${fase3.omitido.slice(0, 160)}`)
    } catch (e) {
      const texto = e instanceof Error ? e.message : String(e)
      console.error(`[ads] propuestas de puja y presupuesto de ${cuenta.id}:`, texto)
      errores.push(`pujas y presupuesto: ${texto.slice(0, 120)}`)
    }
  }
  await deps.marcarGenerado(cuenta.id)
  return { resumen, fase3, nuevas, errores }
}

/**
 * Un paso del motor en una cuenta: términos → propuestas → piloto automático. `modo`: el de la cuenta (cuentasDelMotorConTrabajo lo trae); si no viene, se lee.
 * En modo «agente» la fase 3 va con los ajustes del agente; el piloto automático, solo en «autopiloto».
 */
export async function pasoDelMotor(cuenta: CuentaParaSincronizar, modo?: ModoDelMotor): Promise<PasoDelMotor> {
  const elModo: ModoDelMotor = modo ?? (await leerModo(cuenta.id))
  const t = await avanzarTerminos(cuenta)
  const errores: string[] = []
  let nuevas = 0
  let generado = false
  if (await hayQueGenerar(cuenta.id, t.accion)) {
    const g = await generarDelMotor(cuenta, elModo)
    nuevas = g.nuevas
    generado = true
    errores.push(...g.errores)
  }
  if (t.accion === 'error' && t.detalle) errores.push(`términos: ${t.detalle.slice(0, 120)}`)
  let aplicadas = 0
  let fallidas = 0
  // Solo en autopiloto (pilotoAutomatico vuelve a leer el modo por si ha cambiado entre medias). En «agente» aplica el agente desde su proceso
  if (elModo === 'autopiloto') {
    const r = await pilotoAutomatico(cuenta)
    aplicadas = r.aplicadas
    fallidas = r.fallidas
  }
  return { terminos: t.accion, generado, nuevas, aplicadas, fallidas, errores }
}
