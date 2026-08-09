/**
 * EL REFRESCO A DOS VELOCIDADES
 * =============================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Esto es lo que decide QUÉ TOCA REFRESCAR y cuándo. No refresca nada: solo mete
 * trabajos en la cola. Quien los ejecuta es el motor (lib/plataforma/motor.ts),
 * en su propia pasada y con su propio presupuesto de tiempo.
 *
 * Esa separación es el punto entero del fichero: PLANIFICAR ES BARATO Y
 * EJECUTAR ES CARO. Planificar son dos consultas por cliente y ni una llamada a
 * Amazon, así que puede correr dentro de un ciclo corto sin estorbarle. Ejecutar
 * un barrido completo de 13.700 referencias son horas, y por eso vive en la cola
 * y no en ningún ciclo.
 *
 *
 * LAS TRES VELOCIDADES, QUE SON LAS DE LA ESPECIFICACIÓN
 * -----------------------------------------------------
 *   DIARIO    -> solo el subconjunto en seguimiento. Tiene que caber en una
 *                ventana nocturna. Aquí entran el recálculo del conjunto activo,
 *                el inventario y el BSR.
 *   SEMANAL   -> el barrido del catálogo completo: el censo y los atributos.
 *                Trabajo largo, por lotes, reanudable.
 *   A DEMANDA -> lo que pida una persona desde la pantalla. No pasa por aquí:
 *                entra por la ruta de API con prioridad alta.
 *
 * La cadencia diaria son VEINTE horas y no veinticuatro, y la semanal ciento
 * cuarenta y cuatro y no ciento sesenta y ocho. El motivo está en refresco.ts:
 * con veinticuatro clavadas, un barrido que ayer empezó a las 02:00 y hoy llega
 * a las 01:58 se descarta por dos minutos, y ese cliente se salta un día entero
 * sin que nada falle.
 *
 *
 * CUMPLIMIENTO ANTE AMAZON
 * ------------------------
 * Este fichero recorre los clientes de uno en uno y crea trabajos de uno en uno.
 * NO agrega, NO compara y NO ordena nada entre clientes: los datos de un
 * vendedor se usan exclusivamente para operar su cuenta. Si algún día alguien
 * quiere «priorizar a los clientes con más SKU», eso es un orden calculado
 * cruzando cuentas y no se puede hacer aquí.
 */

import { registrarEvento } from './eventos'
import { crearJob, isMissingSchema } from './jobs'
import { conexionesDeCliente, unidadesDe } from './datos'
import {
  CADENCIA_HORAS,
  VENTANA_NOCTURNA,
  ventanaDeRefresco,
  type VelocidadRefresco,
  type VentanaHoraria,
} from './refresco'
import { createServiceClient } from '@/lib/supabase/service'
import type { AmazonJobTipo } from './tipos'

/* ------------------------------------------------------------------ */
/* Qué se refresca, con qué velocidad y en qué orden                   */
/* ------------------------------------------------------------------ */

interface Refresco {
  tipo: AmazonJobTipo
  velocidad: VelocidadRefresco
  /**
   * Menor va antes en la cola.
   *
   * El orden NO es caprichoso: `recalcular_activos` decide el subconjunto sobre
   * el que trabajan los demás, así que va delante. Si fuera detrás, la lectura
   * diaria de una noche usaría el conjunto activo de la anterior, que es
   * exactamente el tipo de desfase de un día que nadie llega a diagnosticar.
   */
  prioridad: number
  /** Franja en la que se permite ARRANCAR. Un trabajo que empieza a las 05:50 y
      tarda dos horas NO se corta a las 06:00: cortarlo dejaría el catálogo a
      medias, que es peor que acabar tarde */
  ventana: VentanaHoraria | null
  /** true = un trabajo por conexión y marketplace. false = uno por cliente */
  porUnidad: boolean
  parametros?: Record<string, unknown>
}

const REFRESCOS: Refresco[] = [
  {
    // Va el primero de la noche: es de quién depende todo lo demás y no gasta
    // ni una ficha del cupo de Amazon.
    tipo: 'recalcular_activos',
    velocidad: 'diario',
    prioridad: 40,
    ventana: VENTANA_NOCTURNA,
    porUnidad: false,
  },
  {
    tipo: 'inventario_fba',
    velocidad: 'diario',
    prioridad: 50,
    ventana: VENTANA_NOCTURNA,
    porUnidad: true,
    parametros: { soloActivos: true },
  },
  {
    // El BSR sí se mueve todos los días, y es el dato que NO se puede
    // reconstruir hacia atrás: el día que no se guarda, se pierde para siempre.
    tipo: 'snapshot_bsr',
    velocidad: 'diario',
    prioridad: 60,
    ventana: VENTANA_NOCTURNA,
    porUnidad: true,
    parametros: { soloActivos: true },
  },
  {
    // El censo va antes que los atributos: los atributos se piden POR ASIN, y
    // los ASIN los descubre el censo.
    tipo: 'censo_catalogo',
    velocidad: 'semanal',
    prioridad: 80,
    ventana: VENTANA_NOCTURNA,
    porUnidad: true,
  },
  {
    tipo: 'enriquecer_catalogo',
    velocidad: 'semanal',
    prioridad: 90,
    ventana: VENTANA_NOCTURNA,
    porUnidad: true,
    parametros: { soloActivos: false },
  },
]

/**
 * Tope de trabajos nuevos por pasada.
 *
 * No es por la base —una fila cuesta nada— sino por la primera vez: con
 * dieciséis clientes, varios marketplaces y cinco refrescos, el estreno crearía
 * más de doscientos trabajos de golpe y la pantalla de trabajos nacería
 * ilegible. Con el tope, la cola se llena en unas cuantas pasadas de cinco
 * minutos y no se pierde ninguno: lo que no entra hoy entra en la siguiente,
 * porque la cadencia sigue vencida.
 */
const MAX_NUEVOS_POR_PASADA = 60

/* ------------------------------------------------------------------ */
/* El plan                                                             */
/* ------------------------------------------------------------------ */

export interface EntradaPlan {
  tipo: AmazonJobTipo
  clientId: string
  cliente: string
  connectionId: string | null
  marketplaceId: string | null
  /** true si se ha creado; false si no le tocaba o ya había uno vivo */
  creado: boolean
  jobId: string | null
  /** En español y ya redactado. Es lo que explica por qué sí o por qué no */
  motivo: string
}

export interface ResultadoPlan {
  ahora: string
  clientes: number
  creados: number
  yaVivos: number
  entradas: EntradaPlan[]
  /** Por qué no se ha planificado nada, si es que no se ha planificado nada */
  omitido: string | null
}

export interface OpcionesPlan {
  ahora?: Date
  /** Solo este cliente. Para probar sin tocar a los demás */
  clientId?: string | null
  /**
   * Salta la comprobación de cadencia y de ventana horaria.
   *
   * NO salta la exclusión de trabajos vivos: eso lo garantiza un índice único de
   * la base, no este código, y forzar no puede significar «lanza dos barridos
   * del mismo catálogo a la vez».
   */
  forzar?: boolean
  maxNuevos?: number
}

interface ClienteFila {
  id: string
  name: string
}

/**
 * Mete en la cola lo que toque refrescar.
 *
 * NUNCA LANZA hacia arriba salvo por un fallo de verdad de la base: que un
 * cliente no tenga conexiones o que su tabla no esté todavía no puede impedir
 * que se planifiquen los otros quince.
 */
export async function planificarRefrescos(
  opciones: OpcionesPlan = {}
): Promise<ResultadoPlan> {
  const ahora = opciones.ahora ?? new Date()
  const maxNuevos = opciones.maxNuevos ?? MAX_NUEVOS_POR_PASADA
  const entradas: EntradaPlan[] = []

  let clientes: ClienteFila[]
  try {
    clientes = await clientesActivos(opciones.clientId ?? null)
  } catch (error) {
    if (isMissingSchema(error)) {
      return {
        ahora: ahora.toISOString(),
        clientes: 0,
        creados: 0,
        yaVivos: 0,
        entradas: [],
        omitido:
          'Faltan las tablas de la plataforma: lanza 123_plataforma_a1.sql en el editor SQL de Supabase.',
      }
    }
    throw error
  }

  let creados = 0
  let yaVivos = 0

  for (const cliente of clientes) {
    if (creados >= maxNuevos) break

    // UNA consulta por cliente para saber cuándo terminó cada cosa por última
    // vez. Preguntarlo por cada refresco y cada unidad serían decenas de viajes
    // por cliente y por pasada, cada cinco minutos, para leer lo mismo.
    const ultimos = await ultimosTerminados(cliente.id)
    const conexiones = await conexionesDeCliente(cliente.id)
    const unidades = unidadesDe(conexiones)

    for (const refresco of REFRESCOS) {
      if (creados >= maxNuevos) break

      const destinos: Array<{ connectionId: string | null; marketplaceId: string | null }> =
        refresco.porUnidad
          ? unidades.map((u) => ({ connectionId: u.connectionId, marketplaceId: u.marketplaceId }))
          : [{ connectionId: null, marketplaceId: null }]

      for (const destino of destinos) {
        if (creados >= maxNuevos) break

        const clave = claveUltimo(refresco.tipo, destino.connectionId, destino.marketplaceId)
        const ultimo = ultimos.get(clave) ?? null

        const plan = ventanaDeRefresco({
          velocidad: refresco.velocidad,
          ahora,
          ultimo,
          cadenciaHoras: opciones.forzar ? 0 : CADENCIA_HORAS[refresco.velocidad],
          ventana: opciones.forzar ? null : refresco.ventana,
        })

        if (!plan.leToca) {
          entradas.push({
            tipo: refresco.tipo,
            clientId: cliente.id,
            cliente: cliente.name,
            connectionId: destino.connectionId,
            marketplaceId: destino.marketplaceId,
            creado: false,
            jobId: null,
            motivo: plan.motivo,
          })
          continue
        }

        const { job, yaExistia } = await crearJob({
          tipo: refresco.tipo,
          clientId: cliente.id,
          connectionId: destino.connectionId,
          marketplaceId: destino.marketplaceId,
          prioridad: refresco.prioridad,
          parametros: refresco.parametros,
          // null a propósito: lo ha creado el planificador, que no es nadie. Es
          // lo que hace que la campana avise si algo falla — un trabajo lanzado
          // por una persona no suena, porque esa persona está mirando.
          createdBy: null,
        })

        if (yaExistia) yaVivos += 1
        else creados += 1

        entradas.push({
          tipo: refresco.tipo,
          clientId: cliente.id,
          cliente: cliente.name,
          connectionId: destino.connectionId,
          marketplaceId: destino.marketplaceId,
          creado: !yaExistia,
          jobId: job.id,
          motivo: yaExistia
            ? 'Le tocaba, pero ya había uno de este tipo en la cola o en marcha.'
            : plan.motivo,
        })
      }
    }
  }

  if (creados >= maxNuevos) {
    await registrarEvento({
      tipo: 'plan_tope_alcanzado',
      severidad: 'info',
      mensaje:
        `El planificador ha creado ${creados} trabajos y se ha parado en el tope de esta pasada. ` +
        'Lo que falta entra en la siguiente: nada se pierde, porque su cadencia sigue vencida.',
      huella: 'plan_tope_alcanzado',
    })
  }

  return {
    ahora: ahora.toISOString(),
    clientes: clientes.length,
    creados,
    yaVivos,
    entradas,
    omitido: null,
  }
}

/* ------------------------------------------------------------------ */
/* Lecturas                                                            */
/* ------------------------------------------------------------------ */

async function clientesActivos(clientId: string | null): Promise<ClienteFila[]> {
  const service = createServiceClient()
  let consulta = service.from('amazon_clients').select('id, name').eq('is_active', true)
  if (clientId) consulta = consulta.eq('id', clientId)
  const { data, error } = await consulta
    .order('position', { ascending: true })
    .order('name', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as ClienteFila[]
}

function claveUltimo(
  tipo: AmazonJobTipo,
  connectionId: string | null,
  marketplaceId: string | null
): string {
  return `${tipo}|${connectionId ?? ''}|${marketplaceId ?? ''}`
}

/**
 * Cuándo terminó BIEN por última vez cada refresco de este cliente.
 *
 * Solo cuentan los 'terminado'. Un trabajo que acabó en error o cancelado NO
 * marca la cadencia: si contara, un cliente cuyo censo falla cada noche se
 * quedaría una semana sin volver a intentarlo, que es lo contrario de lo que
 * hace falta.
 *
 * El límite de 500 filas es de sobra: son cinco refrescos por unos pocos
 * marketplaces, y se leen ordenados de más nuevo a más viejo, así que el primero
 * de cada clave es el que vale.
 */
async function ultimosTerminados(clientId: string): Promise<Map<string, Date>> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_jobs')
    .select('tipo, connection_id, marketplace_id, terminado_at')
    .eq('client_id', clientId)
    .eq('estado', 'terminado')
    .not('terminado_at', 'is', null)
    // Solo los barridos completos marcan la cadencia. Un trabajo de prueba sobre
    // veinte referencias no puede hacer que el barrido de verdad se salte una
    // semana.
    .is('skus_filtro', null)
    .order('terminado_at', { ascending: false })
    .limit(500)
  if (error) throw error

  const salida = new Map<string, Date>()
  for (const fila of (data ?? []) as Array<{
    tipo: AmazonJobTipo
    connection_id: string | null
    marketplace_id: string | null
    terminado_at: string
  }>) {
    const clave = claveUltimo(fila.tipo, fila.connection_id, fila.marketplace_id)
    if (salida.has(clave)) continue
    const fecha = new Date(fila.terminado_at)
    if (Number.isFinite(fecha.getTime())) salida.set(clave, fecha)
  }
  return salida
}
