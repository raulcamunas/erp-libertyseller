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
import { marketplaceById } from '@/lib/types/amazon'
import { hayEspejo } from './catalogo'
import { conexionesDeCliente, unidadesDe, type UnidadDeTrabajo } from './datos'
import {
  cadenciaBsr,
  porQueSinBsr,
  type ModeloNegocio,
  type PoliticaBsr,
} from './modelo-negocio'
import {
  VENTANA_NOCTURNA,
  ventanaDeRefresco,
  type VelocidadRefresco,
  type VentanaHoraria,
} from './refresco'
import { configPorDefecto, leerConfigRefrescos, ventanaDe } from './refresco-config'
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
    // ---------- A2 · Precios y Buy Box ----------
    // Va DETRÁS del inventario y del BSR y no es indiferente: su tercera fase
    // diagnostica «sin stock», y para eso necesita la lectura de existencias de
    // esta misma noche. Con el orden al revés, el diagnóstico usaría el stock de
    // ayer y un SKU que se agotó anoche saldría como problema de precio.
    //
    // Lo caro de aquí dentro es el FOEP: una petición cada treinta segundos. Por
    // eso el trabajo NO lo pide para todo el catálogo cada noche, sino por
    // rotación más la cola de los que acaban de perder la oferta destacada. Ver
    // lib/plataforma/buybox/rotacion.ts.
    tipo: 'snapshot_precios',
    velocidad: 'diario',
    prioridad: 70,
    ventana: VENTANA_NOCTURNA,
    porUnidad: true,
    /**
     * TODO EL CATÁLOGO CON STOCK, y no el subconjunto en seguimiento.
     *
     * La fase que contesta «¿gano la Buy Box?» cuesta 4 min 22 s para 2.620
     * referencias: cabe cada cuarto de hora. Lo caro es el FOEP, y ese no barre
     * el ámbito —va por cola y rotación con su tope—, así que abrir esto no
     * encarece la parte cara. Ver la cabecera de buybox/tarea.ts.
     *
     * Sin stock no se puede ganar la oferta destacada, así que preguntarlo sería
     * gastar cupo en algo que no puede pasar.
     */
    parametros: { soloActivos: false, soloConStock: true },
  },
  {
    /**
     * ---------- Tarifas de Amazon ----------
     * DETRÁS de «precios y Buy Box», y no es indiferente: la tarifa se pide al
     * PRECIO DE EVALUACIÓN, que sale de cruzar el precio actual con el FOEP, y
     * el FOEP lo trae el trabajo anterior. Con el orden al revés se pediría la
     * tarifa al precio de ayer y `margen()` la descartaría por estar fuera de
     * tolerancia — con la tabla llena, que es el peor de los dos fallos.
     */
    tipo: 'tarifas',
    velocidad: 'diario',
    prioridad: 75,
    ventana: VENTANA_NOCTURNA,
    porUnidad: true,
    parametros: { soloActivos: false, soloConStock: true },
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
  modelo_negocio: string | null
  bsr_politica: string | null
}

/**
 * Mete en la cola lo que toque refrescar.
 *
 * NUNCA LANZA hacia arriba salvo por un fallo de verdad de la base: que un
 * cliente no tenga conexiones o que su tabla no esté todavía no puede impedir
 * que se planifiquen los otros quince.
 */
/**
 * ¿Tiene espejo esta unidad? Con memoria dentro de la pasada.
 *
 * Se pregunta una vez por unidad y no una por refresco: son cinco refrescos que
 * leen el espejo, así que sin la memoria serían cinco consultas idénticas por
 * cada cuenta y país, por cada cliente y en cada pasada del planificador.
 *
 * Un fallo al preguntar NO bloquea: se contesta que sí. Un guardián que decide
 * si algo se ejecuta tiene que fallar del lado de que se ejecute — equivocarse
 * por encolar de más cuesta un trabajo que procesa 0, y equivocarse por no
 * encolar deja al cliente sin refrescos y sin ninguna señal de por qué.
 */
async function espejoDe(
  unidad: UnidadDeTrabajo,
  memoria: Map<string, boolean>
): Promise<boolean> {
  const clave = `${unidad.connectionId}|${unidad.marketplaceId}`
  const guardado = memoria.get(clave)
  if (guardado !== undefined) return guardado
  try {
    const hay = await hayEspejo(unidad)
    memoria.set(clave, hay)
    return hay
  } catch {
    memoria.set(clave, true)
    return true
  }
}

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

  /**
   * El horario de cada refresco, de la base y no del código.
   *
   * Se lee UNA VEZ por pasada y no por cliente: son seis filas y hay dieciséis
   * clientes, así que leerlo dentro del bucle serían noventa y seis consultas
   * para obtener siempre lo mismo.
   */
  /** Memoria de «¿tiene espejo?» durante esta pasada. Ver espejoDe() */
  const espejos = new Map<string, boolean>()

  const horarios = await leerConfigRefrescos(REFRESCOS.map((r) => r.tipo))
  const horarioDe = (tipo: AmazonJobTipo) =>
    horarios.find((h) => h.tipo === tipo) ?? configPorDefecto(tipo)

  let creados = 0
  let yaVivos = 0

  for (const cliente of clientes) {
    if (creados >= maxNuevos) break

    // UNA consulta por cliente para saber cuándo terminó cada cosa por última
    // vez. Preguntarlo por cada refresco y cada unidad serían decenas de viajes
    // por cliente y por pasada, cada cinco minutos, para leer lo mismo.
    const ultimos = await ultimosTerminados(cliente.id)
    const conexiones = await conexionesDeCliente(cliente.id)
    /**
     * SOLO LOS MARKETPLACES QUE SABEMOS NOMBRAR.
     *
     * `getMarketplaceParticipations` devuelve con `isParticipating: true` cosas
     * que no son tiendas de verdad —marketplaces de sandbox, entradas internas
     * de Amazon—, y el filtro de participación no las quita. En la cuenta
     * piloto eran cuatro de ocho: la mitad de la cola eran trabajos contra
     * sitios donde el cliente no vende nada, gastando cupo que sí hace falta
     * en los otros cuatro.
     *
     * NO SE SALTAN EN SILENCIO. Se listan con su motivo, porque la otra
     * posibilidad es que sea una tienda real que falta en el catálogo de
     * lib/types/amazon.ts, y entonces el que se está quedando sin ingesta es un
     * cliente de verdad. Un hueco que se ve se arregla; uno que no, no.
     */
    const todas = unidadesDe(conexiones)
    const unidades = todas.filter((u) => marketplaceById(u.marketplaceId))

    for (const desconocida of todas.filter((u) => !marketplaceById(u.marketplaceId))) {
      entradas.push({
        tipo: 'censo_catalogo',
        clientId: cliente.id,
        cliente: cliente.name,
        connectionId: desconocida.connectionId,
        marketplaceId: desconocida.marketplaceId,
        creado: false,
        jobId: null,
        motivo:
          `El marketplace ${desconocida.marketplaceId} no está en el catálogo del ERP, así que no se ` +
          'programa nada contra él. Suele ser uno de sandbox. Si es una tienda real donde el cliente ' +
          'vende, hay que añadirlo en lib/types/amazon.ts o se queda sin ingesta.',
      })
    }

    for (const refresco of REFRESCOS) {
      if (creados >= maxNuevos) break

      /**
       * Un refresco apagado desde la pantalla no se encola.
       *
       * NO se salta cuando se fuerza: «Forzar todos» ignora el reloj, no la
       * decisión de que esto no debe correr solo. Para lanzar uno apagado está
       * «Lanzar un trabajo», que es explícito y sobre lo que tú elijas.
       */
      const horario = horarioDe(refresco.tipo)
      if (!horario.activo) {
        entradas.push({
          tipo: refresco.tipo,
          clientId: cliente.id,
          cliente: cliente.name,
          connectionId: null,
          marketplaceId: null,
          creado: false,
          jobId: null,
          motivo: 'Apagado en la configuración de refrescos.',
        })
        continue
      }

      /**
       * EL BSR NO SE LE PIDE A TODO EL MUNDO, y es lo que hace que la ventana
       * nocturna quepa.
       *
       * En reventa el BSR es del ASIN de otro: mide cómo se vende EL PRODUCTO,
       * no cómo lo hace este cliente. Puede mejorar mientras él pierde todas
       * sus ventas por no tener la Buy Box. Y son justo los catálogos enormes
       * —ShoesF ~13.700 SKU, Keslem hasta 30.000—, así que barrerlos a diario
       * son unas seis horas de cupo midiendo catálogo ajeno.
       *
       * Se salta el DIARIO, no la medición: el trabajo se puede lanzar a mano
       * desde «Lanzar un trabajo» sobre los SKU que se estén evaluando. Sin esa
       * puerta, A4 se quedaría sin ninguna señal de rotación, que es lo único
       * que tenemos mientras no llegue el rol de Análisis de marcas.
       *
       * `mix` se resuelve SKU a SKU dentro de la tarea; aquí solo se descarta
       * el cliente que NO tiene ni un SKU de marca propia.
       */
      if (refresco.tipo === 'snapshot_bsr' && !opciones.forzar) {
        const cadencia = cadenciaBsr({
          modelo: (cliente.modelo_negocio ?? 'mix') as ModeloNegocio,
          politica: (cliente.bsr_politica ?? 'auto') as PoliticaBsr,
          // En 'mix' decide la tarea SKU a SKU, así que aquí se deja pasar.
          esMarcaPropia: (cliente.modelo_negocio ?? 'mix') === 'mix',
        })
        if (cadencia !== 'diario') {
          entradas.push({
            tipo: refresco.tipo,
            clientId: cliente.id,
            cliente: cliente.name,
            connectionId: null,
            marketplaceId: null,
            creado: false,
            jobId: null,
            motivo:
              porQueSinBsr({
                modelo: (cliente.modelo_negocio ?? 'mix') as ModeloNegocio,
                politica: (cliente.bsr_politica ?? 'auto') as PoliticaBsr,
                esMarcaPropia: false,
              }) ?? 'Este cliente no mide el BSR a diario.',
          })
          continue
        }
      }

      const destinos: Array<{ connectionId: string | null; marketplaceId: string | null }> =
        refresco.porUnidad
          ? unidades.map((u) => ({ connectionId: u.connectionId, marketplaceId: u.marketplaceId }))
          : [{ connectionId: null, marketplaceId: null }]

      for (const destino of destinos) {
        if (creados >= maxNuevos) break

        /**
         * NO SE ENCOLA UN TRABAJO QUE VA A MIRAR UN ESPEJO VACÍO.
         *
         * El caso real: un cliente recién conectado. Los trabajos diarios
         * corrieron a las 13:42 y el ciclo de catálogo trajo sus 775
         * referencias a las 13:43. Miraron un espejo vacío, procesaron 0,
         * terminaron EN VERDE y —lo caro— marcaron su cadencia como cumplida:
         * el BSR y el inventario de ese cliente no volvían a mirar hasta veinte
         * horas después. Un día entero de histórico perdido sin un solo error.
         *
         * Se ataca en el ORIGEN y no en el cierre: el trabajo que no puede hacer
         * nada no llega a existir, así que no hay fila «terminado» que consuma
         * cadencia. No hace falta migración, no se toca la máquina de estados y
         * no puede pintar nada en rojo.
         *
         * Y SE CURA SOLO: en cuanto el censo o el ciclo de quince minutos meten
         * la primera fila, el refresco se vuelve a programar en la pasada
         * siguiente, porque su cadencia sigue vencida.
         *
         * EL CENSO QUEDA FUERA a propósito: es justamente el que LLENA el
         * espejo. Excluirlo de esta comprobación es lo único que impide un
         * bloqueo mutuo en el que nadie corre porque nadie ha traído nada.
         */
        if (refresco.tipo !== 'censo_catalogo' && destino.connectionId && destino.marketplaceId) {
          const unidad = unidades.find(
            (u) =>
              u.connectionId === destino.connectionId &&
              u.marketplaceId === destino.marketplaceId
          )
          if (unidad && !(await espejoDe(unidad, espejos))) {
            entradas.push({
              tipo: refresco.tipo,
              clientId: cliente.id,
              cliente: cliente.name,
              connectionId: destino.connectionId,
              marketplaceId: destino.marketplaceId,
              creado: false,
              jobId: null,
              motivo:
                'El espejo del catálogo de esta cuenta y país está vacío: no hay nada que ' +
                'refrescar todavía. Se espera al censo o al ciclo de quince minutos, y en cuanto ' +
                'traigan la primera referencia este refresco se programa solo.',
            })
            continue
          }
        }

        const clave = claveUltimo(refresco.tipo, destino.connectionId, destino.marketplaceId)
        const ultimo = ultimos.get(clave) ?? null

        /**
         * La cadencia y la ventana salen de refresco_config, no del código.
         *
         * `refresco.velocidad` sigue existiendo porque decide OTRAS cosas —el
         * ámbito del trabajo, si barre el catálogo entero o solo el subconjunto
         * activo— pero ya no decide cuándo. Eran la misma constante haciendo dos
         * trabajos distintos, y por eso bajar el censo a 4 horas obligaba a
         * bajar también el de atributos.
         */
        const plan = ventanaDeRefresco({
          velocidad: refresco.velocidad,
          ahora,
          ultimo,
          cadenciaHoras: opciones.forzar ? 0 : horario.cada_minutos / 60,
          ventana: opciones.forzar ? null : ventanaDe(horario),
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
          parametros:
            refresco.tipo === 'snapshot_bsr' && (cliente.modelo_negocio ?? 'mix') === 'mix'
              ? // Cliente MIXTO: revende y además tiene marca suya. El barrido
                // diario de BSR se queda solo con lo suyo, que es lo único de
                // lo que ese ranking dice algo sobre su cuenta.
                { ...refresco.parametros, soloMarcaPropia: true }
              : refresco.parametros,
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
  let consulta = service
    .from('amazon_clients')
    .select('id, name, modelo_negocio, bsr_politica')
    .eq('is_active', true)
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
