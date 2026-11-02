import { createServiceClient } from '@/lib/supabase/service'
import { enlaceDeDescarga, faltaLa200 } from '@/lib/tax-reports/datos'
import { normalizarNombre } from '@/lib/facturacion/tipos'
import {
  type CampoDeFichero,
  type CandidatoTesoreria,
  type ClienteDeComisiones,
  type ConflictoDeGuardado,
  type DescargaPlanificada,
  type EstadoDelMes,
  type FicheroDelMes,
  type GuardadoHecho,
  type MesDeTesoreria,
  CLIENTES_FUERA_DEL_PANEL,
  type PlanDeCalculo,
  type ResumenDeCliente,
  type ResumenDelMes,
  type SituacionDelCliente,
  importeDeCalculo,
  mesEnLetra,
  perfilDeCalculo,
  periodoDe,
} from '@/lib/comisiones-puente/tipos'

/**
 * EL PUENTE — EL ÚNICO SITIO QUE TOCA LA BASE.
 * ============================================
 * SOLO SERVIDOR. Importar esto desde un componente de navegador arrastraría la
 * clave de servicio al JavaScript que se descarga cualquiera.
 *
 *
 * ============ LO QUE ESTE MÓDULO HACE Y LO QUE NO ============
 *
 * HACE: encontrar el fichero de un cliente para un mes en Tax Reports, decir qué
 * falta, firmar los enlaces con los que la pantalla se lo lleva al cálculo de
 * siempre, y —después, en un paso aparte— escribir el importe validado en
 * Tesorería.
 *
 * NO HACE: calcular. Ni una suma. El cálculo es
 * `app/api/commissions/process/route.ts` y no se toca ni se copia.
 *
 * NO HACE TAMPOCO: abrir el fichero. Dentro de un tax report van, fila a fila,
 * la ciudad, el código postal y el país de entrega de cada pedido, el Order ID y
 * el enlace a la factura del COMPRADOR. Aquí no se parsea ni una línea y no se
 * guarda nada de su contenido en ninguna columna nueva: lo único que acaba en la
 * base es UN NÚMERO, la comisión.
 *
 *
 * ============ POR QUÉ SE USA LA CLAVE DE SERVICIO ============
 *
 * Porque hay que leer tres sitios con tres dueños distintos en una sola
 * pantalla: `tax_report_ficheros` (permiso de app), `treasury_client_months`
 * (RLS de admin/socio, migración 095) e `invoices`. Con la sesión del navegador
 * eso serían tres consultas que pueden devolver CERO FILAS SIN ERROR según quién
 * mire, y una fila que falta aquí no es una fila que falta: es un mes que parece
 * libre y se sobrescribe.
 *
 * El precio de la clave de servicio es que se salta la RLS, así que TODAS las
 * rutas que llaman aquí exigen admin o socio ELLAS MISMAS en su primera línea
 * —middleware.ts declara pública toda /api/—. Si alguien añade una ruta nueva a
 * este módulo y se olvida de esa línea, la está abriendo a internet.
 */

/* ------------------------------------------------------------------ */
/* ¿FALTA LANZAR LA 201?                                               */
/* ------------------------------------------------------------------ */

/**
 * Las migraciones se lanzan a mano, así que el código puede llegar desplegado
 * antes que ellas. Sin esto, la pantalla daría un 500 genérico y nadie
 * relacionaría «no se ha podido completar la operación» con un .sql sin pegar.
 *
 * Mismos códigos que mira `faltaLa200`: 42703 y PGRST204 son «esa columna no
 * existe», que es justo lo que pasa antes de la 201.
 */
export function faltaLa201(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === '42703' || code === 'PGRST204'
}

export const MENSAJE_FALTA_LA_201 =
  'Falta lanzar la migración 201_puente_comision_tesoreria.sql en el editor SQL de Supabase: sin ella ' +
  'no existe la columna que dice en qué cliente de Tesorería se escribe la comisión de cada cliente.'

export const MENSAJE_FALTA_LA_200 =
  'Falta lanzar la migración 200_tax_reports.sql en el editor SQL de Supabase: sin ella no existe la ' +
  'rejilla donde el día 3 se cuelgan los informes, así que aquí no hay ningún fichero que coger.'

/* ------------------------------------------------------------------ */
/* FILAS DE LA BASE                                                    */
/* ------------------------------------------------------------------ */

interface FilaCliente extends ClienteDeComisiones {
  /** Puede no venir: antes de la 201 la columna no existe */
  treasury_client_id?: string | null
}

interface FilaFichero {
  id: string
  anio: number
  mes: number
  nombre_original: string
  subido_at: string
  purgado_at: string | null
}

interface FilaMesTesoreria {
  id: string
  client_id: string
  period: string
  fee: number | null
  commission: number | null
}

/** Cuántos meses hacia atrás se traen para enseñar al lado de cada candidato */
const MESES_DE_CONTEXTO = 3

/* ------------------------------------------------------------------ */
/* 1) EL ESTADO DE UN MES                                              */
/* ------------------------------------------------------------------ */

/**
 * TODO lo que la pantalla necesita para pintar un cliente y un mes, en una sola
 * respuesta: si hay fichero, cuál falta, con quién está emparejado en Tesorería,
 * qué candidatos hay y qué tiene ese mes apuntado ya.
 *
 * Se devuelve ENTERO también después de emparejar, y no solo el trozo que
 * cambia: es lo mismo que hacen las rutas de Tax Reports y por el mismo motivo
 * —dos formas de construir el mismo estado es como se llega a que después de
 * guardar, la cabecera diga una cosa y la tarjeta de abajo otra—.
 */
export async function leerEstadoDelMes(
  clienteId: string,
  anio: number,
  mes: number
): Promise<EstadoDelMes | { noExiste: true }> {
  const service = createServiceClient()

  const { data: clienteRaw, error: errorCliente } = await service
    .from('clients')
    .select('*')
    .eq('id', clienteId)
    .maybeSingle()

  if (errorCliente) throw errorCliente
  if (!clienteRaw) return { noExiste: true }

  const cliente = clienteRaw as FilaCliente

  /**
   * LA COLUMNA PUEDE NO EXISTIR TODAVÍA.
   *
   * Se pide `*` y se mira si la clave está, en vez de nombrarla en el select:
   * nombrándola, PostgREST contesta un 42703 y la pantalla entera se queda en un
   * error en vez de poder decir «falta pegar la 201». Aquí el resto del estado
   * se puede calcular igual y solo el emparejado queda fuera de servicio.
   */
  const hayColumna = Object.prototype.hasOwnProperty.call(cliente, 'treasury_client_id')
  const treasuryClientId = hayColumna ? (cliente.treasury_client_id ?? null) : null

  const perfil = perfilDeCalculo(cliente)
  const period = periodoDe(anio, mes)

  /* ---------- Los ficheros de Tax Reports ---------- */

  let ficheroActual: FicheroDelMes | null = null
  let ficheroAnterior: FicheroDelMes | null = null
  let faltaLa200Aqui = false
  let estaEnTaxReports = false

  try {
    const { data: filaTax, error: errorTax } = await service
      .from('tax_report_clientes')
      .select('id')
      .eq('client_id', clienteId)
      .maybeSingle()

    if (errorTax) throw errorTax

    if (filaTax) {
      estaEnTaxReports = true
      const taxClienteId = (filaTax as { id: string }).id

      // Los dos meses de una vez: el pedido y el MISMO MES DEL AÑO ANTERIOR.
      // `anio - 1` no es un mes anterior: los clientes de dos ficheros comparan
      // el excedente de este año contra el del pasado.
      const { data: ficheros, error: errorFicheros } = await service
        .from('tax_report_ficheros')
        .select('id, anio, mes, nombre_original, subido_at, purgado_at')
        .eq('cliente_id', taxClienteId)
        .in('anio', [anio, anio - 1])
        .eq('mes', mes)

      if (errorFicheros) throw errorFicheros

      for (const raw of (ficheros ?? []) as FilaFichero[]) {
        const fichero: FicheroDelMes = {
          id: raw.id,
          anio: raw.anio,
          mes: raw.mes,
          nombreOriginal: raw.nombre_original,
          subidoAt: raw.subido_at,
          purgado: raw.purgado_at != null,
        }
        if (raw.anio === anio) ficheroActual = fichero
        else ficheroAnterior = fichero
      }
    }
  } catch (error) {
    if (!faltaLa200(error)) throw error
    faltaLa200Aqui = true
  }

  /* ---------- Tesorería: la pareja, los candidatos y el mes ---------- */

  const { candidatos, nombreEnlazado } = await candidatosDeTesoreria(
    clienteId,
    cliente.name,
    treasuryClientId
  )

  const tesoreria = treasuryClientId
    ? await leerMesDeTesoreria(treasuryClientId, period)
    : null

  /* ---------- Qué falta, dicho en español ---------- */

  const faltan: string[] = []
  const aMano: CampoDeFichero[] = []

  if (faltaLa200Aqui) {
    faltan.push(MENSAJE_FALTA_LA_200)
  } else if (!estaEnTaxReports) {
    faltan.push(
      `«${cliente.name}» no está enlazado con ninguna fila de Tax Reports, así que el ERP no sabe ` +
        'dónde buscar su informe. Se arregla desde Tax Reports, dando de alta el cliente allí.'
    )
  } else if (!ficheroActual) {
    faltan.push(
      `No hay informe de ${mesEnLetra(anio, mes)} en Tax Reports. El día 3 lo cuelga quien recorre ` +
        'las cuentas; hasta que esté, aquí no se calcula nada.'
    )
  } else if (ficheroActual.purgado) {
    faltan.push(
      `El informe de ${mesEnLetra(anio, mes)} ya se retiró: los ficheros se guardan seis meses ` +
        'porque llevan datos de los compradores. Hay que volver a bajarlo y subirlo a Tax Reports.'
    )
  }

  if (perfil.dosFicheros) {
    const anteriorServible = ficheroAnterior != null && !ficheroAnterior.purgado
    if (!anteriorServible) {
      /**
       * ESTO NO ES UN FALLO: ES ASÍ POR DISEÑO Y NO SE PUEDE ARREGLAR AQUÍ.
       *
       * `tax_report_ficheros` tiene UNIQUE (cliente_id, anio, mes) —una celda por
       * mes— y `purgarInformesCaducados()` retira el fichero del bucket a los 183
       * días. O sea que el informe del MISMO MES DEL AÑO PASADO, que es el que
       * necesitan ShoesF, Farmacia Garrachon y Keslem, estará purgado siempre que
       * se le necesite. Se pide a mano y se dice por qué.
       */
      aMano.push('filePreviousYear')
    }
  }

  const puedeCalcular = Boolean(ficheroActual && !ficheroActual.purgado)

  return {
    cliente: {
      id: cliente.id,
      nombre: cliente.name,
      perfil,
      marcaPropia: cliente.marca_propia ?? null,
    },
    enlace: {
      treasuryClientId,
      nombre: nombreEnlazado,
      candidatos,
    },
    anio,
    mes,
    period,
    ficheroActual,
    ficheroAnterior,
    faltan,
    aMano,
    puedeCalcular,
    tesoreria,
    faltaMigracion: faltaLa200Aqui ? '200' : hayColumna ? false : '201',
  }
}

/**
 * LOS CANDIDATOS DE TESORERÍA, CON LO JUSTO PARA RECONOCERLOS.
 *
 * Y «lo justo» son sus últimos meses con importes. No es adorno: de los once
 * clientes de comisiones, SEIS no se parecen en nada a su fila de Tesorería
 * —Lenobotics es «Ocio Global Import S.L», ShoesF es «Zapaterias Basoco S.L»—,
 * así que un desplegable con veinte nombres de sociedad no se puede resolver
 * leyéndolo. Con 175,14 € en septiembre al lado, sí.
 *
 * `ocupadoPor` marca los que ya tiene enlazados otro cliente de comisiones. No
 * se esconden: se enseñan diciendo de quién son, porque el caso de Ham Master
 * —dos cuentas de Amazon, una sola sociedad— hay que poder VERLO desde aquí en
 * vez de descubrir que el desplegable no ofrece la única fila correcta.
 */
async function candidatosDeTesoreria(
  clienteId: string,
  nombreCliente: string,
  enlazadoA: string | null
): Promise<{ candidatos: CandidatoTesoreria[]; nombreEnlazado: string | null }> {
  const service = createServiceClient()

  const { data: filas, error } = await service
    .from('treasury_clients')
    .select('id, name, is_active')
    .order('name', { ascending: true })

  if (error) throw error

  const clientes = (filas ?? []) as { id: string; name: string; is_active: boolean }[]

  // Quién tiene ya enlazado qué. Se lee de `clients`, que es donde vive el
  // enlace; si la columna no existe todavía, no hay nada ocupado.
  const ocupados = new Map<string, string>()
  const { data: enlazados, error: errorEnlazados } = await service
    .from('clients')
    .select('id, name, treasury_client_id')
    .not('treasury_client_id', 'is', null)

  // Antes de la 201 la columna no existe y esto contesta 42703: eso SÍ se pasa
  // por alto, porque el resto del estado se puede pintar igual y la pantalla ya
  // avisa de que falta pegar el .sql. Cualquier otro error se levanta: si se
  // tragara, el desplegable ofrecería como libres filas de Tesorería que ya
  // tiene otro cliente, y quien las eligiera se comería un 409 sin entender por
  // qué la pantalla se las había ofrecido.
  if (errorEnlazados && !faltaLa201(errorEnlazados)) throw errorEnlazados

  for (const fila of (enlazados ?? []) as {
    id: string
    name: string
    treasury_client_id: string
  }[]) {
    if (fila.id !== clienteId) ocupados.set(fila.treasury_client_id, fila.name)
  }

  // Los últimos meses de TODOS los candidatos, en una sola consulta. Con veinte
  // clientes y tres meses cada uno, pedirlos de uno en uno serían veinte viajes
  // para pintar un desplegable.
  const importes = new Map<
    string,
    { period: string; fee: number | null; commission: number | null }[]
  >()

  const { data: meses, error: errorMeses } = await service
    .from('treasury_client_months')
    .select('client_id, period, fee, commission')
    .order('period', { ascending: false })
    .limit(400)

  if (errorMeses) throw errorMeses

  for (const fila of (meses ?? []) as FilaMesTesoreria[]) {
    if (fila.fee == null && fila.commission == null) continue
    const lista = importes.get(fila.client_id) ?? []
    if (lista.length >= MESES_DE_CONTEXTO) continue
    lista.push({ period: fila.period, fee: fila.fee, commission: fila.commission })
    importes.set(fila.client_id, lista)
  }

  const normalizadoCliente = normalizarNombre(nombreCliente)

  const candidatos: CandidatoTesoreria[] = clientes.map((c) => ({
    id: c.id,
    nombre: c.name,
    activo: c.is_active,
    seParece: normalizarNombre(c.name) === normalizadoCliente,
    ocupadoPor: ocupados.get(c.id) ?? null,
    ultimosMeses: importes.get(c.id) ?? [],
  }))

  const nombreEnlazado = enlazadoA
    ? (clientes.find((c) => c.id === enlazadoA)?.name ?? null)
    : null

  return { candidatos, nombreEnlazado }
}

/** Lo que Tesorería tiene apuntado para ese cliente y ese mes, y si ya se facturó */
async function leerMesDeTesoreria(
  treasuryClientId: string,
  period: string
): Promise<MesDeTesoreria> {
  const service = createServiceClient()

  const [mesRes, facturaRes] = await Promise.all([
    service
      .from('treasury_client_months')
      .select('fee, commission')
      .eq('client_id', treasuryClientId)
      .eq('period', period)
      .maybeSingle(),
    /**
     * LA FACTURA MANDA SOBRE EL IMPORTE.
     *
     * `invoices` guarda sus propios subtotal/vat/total (migración 069) y el PDF
     * los lee de ahí, así que cambiar la comisión después de emitir NO cambia la
     * factura: deja el ERP diciendo un número y el papel que tiene el cliente
     * diciendo otro. Por eso se mira aquí y el guardado se niega.
     *
     * Las anuladas no cuentan, igual que en el índice único de la 176.
     */
    service
      .from('invoices')
      .select('invoice_number, status')
      .eq('treasury_client_id', treasuryClientId)
      .eq('period', period)
      .neq('status', 'cancelled')
      .maybeSingle(),
  ])

  /**
   * SI ALGUNA DE LAS DOS CONSULTAS FALLA, SE REVIENTA. NO SE SIGUE.
   *
   * Es la línea más importante de esta función y hay que decir por qué. Lo que
   * sale de aquí son los DOS frenos del guardado: `facturado` impide escribir en
   * un mes que ya tiene factura, y `commission` es contra lo que se compara para
   * preguntar antes de pisar un importe.
   *
   * Si se ignorara el error —que es lo que pasaba antes: se leía `.data` sin
   * mirar `.error`—, cualquier fallo de la consulta devolvería `facturado:false`
   * y `commission:null`, o sea LOS DOS FRENOS SUELTOS A LA VEZ, y el guardado
   * pisaría sin preguntar el importe de un mes ya facturado. Y no daría ningún
   * error: daría una factura y un ERP diciendo cifras distintas.
   *
   * Un freno que falla tiene que fallar cerrado. Si esto revienta, la pantalla
   * enseña el error y no se guarda nada, que es exactamente lo que queremos.
   */
  if (mesRes.error) throw mesRes.error
  if (facturaRes.error) throw facturaRes.error

  const factura = facturaRes.data as { invoice_number: string } | null

  return {
    period,
    fee: mesRes.data?.fee != null ? Number(mesRes.data.fee) : null,
    commission: mesRes.data?.commission != null ? Number(mesRes.data.commission) : null,
    facturado: factura != null,
    numeroFactura: factura?.invoice_number ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* 2) EL PLAN DE LA LLAMADA AL CÁLCULO                                 */
/* ------------------------------------------------------------------ */

export interface OpcionesDeCalculo {
  /** ShoesF: la tasa forzada, EN PORCENTAJE ('3' = 3 %). Ver route.ts:176 */
  tasaManual?: string | null
  /** SAUSI: '0.15' o '0.35' */
  tramoBeneficio?: string | null
}

export type ResultadoPlan =
  | { ok: true; plan: PlanDeCalculo; estado: EstadoDelMes }
  | { ok: false; estado: number; mensaje: string }

/**
 * PREPARA LA LLAMADA AL CÁLCULO DE SIEMPRE: comprueba que esté todo, firma los
 * enlaces de los ficheros que hacen falta y dice en qué campo del FormData va
 * cada uno.
 *
 * `extras` lleva los campos de texto tal y como los espera el cálculo, sin
 * convertir nada: `manualCommissionRate` va en PORCENTAJE porque route.ts lo
 * divide entre 100 en su línea 176, y `benefitRate` va en tanto por uno
 * ('0.15'). Convertirlos aquí sería cambiarle la comisión a ShoesF por lo bajo.
 */
export async function planDeCalculo(
  clienteId: string,
  anio: number,
  mes: number,
  opciones: OpcionesDeCalculo = {}
): Promise<ResultadoPlan> {
  const estado = await leerEstadoDelMes(clienteId, anio, mes)
  if ('noExiste' in estado) {
    return { ok: false, estado: 404, mensaje: 'Ese cliente no existe' }
  }

  if (!estado.puedeCalcular) {
    return {
      ok: false,
      estado: 409,
      mensaje:
        estado.faltan[0] ??
        `No hay informe de ${mesEnLetra(anio, mes)} en Tax Reports para este cliente.`,
    }
  }

  const { perfil } = estado.cliente
  const descargas: DescargaPlanificada[] = []

  const campoActual: CampoDeFichero = perfil.dosFicheros ? 'fileCurrentYear' : 'file'
  descargas.push(await firmar(estado.ficheroActual!, campoActual))

  if (perfil.dosFicheros && estado.ficheroAnterior && !estado.ficheroAnterior.purgado) {
    descargas.push(await firmar(estado.ficheroAnterior, 'filePreviousYear'))
  }

  const extras: Record<string, string> = {}

  if (perfil.admiteTasaManual && opciones.tasaManual) {
    extras.manualCommissionRate = String(opciones.tasaManual)
  }

  if (perfil.pideTramoBeneficio) {
    // El cálculo lo lee siempre para SAUSI; sin él aplicaría su valor por
    // omisión sin que nadie haya elegido, y la diferencia entre 15 % y 35 % del
    // beneficio no es un matiz.
    const tramo = opciones.tramoBeneficio === '0.35' ? '0.35' : '0.15'
    extras.benefitRate = tramo
  }

  return {
    ok: true,
    estado,
    plan: {
      clientId: clienteId,
      descargas,
      aMano: estado.aMano,
      extras,
      porMarca: perfil.porMarca,
    },
  }
}

/**
 * Firma el enlace de un fichero concreto. Sesenta segundos, uno por fichero, y
 * no se guarda en ningún sitio: es la misma función que usa el botón
 * «Descargar» de Tax Reports (lib/tax-reports/datos.ts).
 */
async function firmar(fichero: FicheroDelMes, campo: CampoDeFichero): Promise<DescargaPlanificada> {
  const enlace = await enlaceDeDescarga(fichero.id)

  if (enlace === null) {
    throw new Error('Ese informe ya no está en Tax Reports. Recarga la pantalla.')
  }
  if (enlace === 'purgado') {
    throw new Error(
      'Ese informe ya se retiró: los ficheros se guardan seis meses porque llevan datos de los ' +
        'compradores. Hay que volver a subirlo a Tax Reports.'
    )
  }

  return { campo, ficheroId: fichero.id, nombre: enlace.nombre, url: enlace.url }
}

/* ------------------------------------------------------------------ */
/* 3) GUARDAR EL IMPORTE VALIDADO                                      */
/* ------------------------------------------------------------------ */

export type ResultadoGuardado =
  | { ok: true; guardado: GuardadoHecho }
  | { ok: false; estado: number; mensaje: string; conflicto?: ConflictoDeGuardado }

/**
 * ESCRIBE `commission` Y SOLO `commission`.
 *
 * TRES COSAS QUE ESTA FUNCIÓN NO HACE, Y CADA UNA ES UNA DECISIÓN:
 *
 *   1. NO TOCA `fee`. Nunca, ni para proponerlo. Ese lo pone Raúl a mano y es
 *      lo pactado con cada cliente; el ERP no tiene de dónde sacarlo. Por eso
 *      aquí se hace UPDATE de un solo campo o INSERT con un solo importe, y no
 *      el upsert de fila entera que usa TreasuryBoard —ese manda `fee` en el
 *      cuerpo, y desde aquí eso significaría escribir `null` encima—.
 *
 *   2. NO PISA UN IMPORTE DISTINTO SIN PREGUNTAR. Si ese mes ya tenía otra
 *      comisión, se devuelve `conflicto` y decide la pantalla. Un recálculo con
 *      el fichero equivocado es la forma más fácil de cambiar una cifra que ya
 *      se había revisado.
 *
 *   3. NO ESCRIBE SI EL MES YA ESTÁ FACTURADO. La factura guarda sus propios
 *      importes, así que cambiar esto después no la cambia: solo consigue que el
 *      ERP y el PDF que tiene el cliente digan cosas distintas.
 *
 * Y una que sí hace: exigir que el cliente tenga pareja en Tesorería. Sin ella
 * no hay ninguna fila donde escribir, y adivinarla por parecido de nombre
 * acierta 5 de 11.
 */
export async function guardarComision(
  clienteId: string,
  anio: number,
  mes: number,
  importe: number,
  confirmar: boolean
): Promise<ResultadoGuardado> {
  const service = createServiceClient()
  const period = periodoDe(anio, mes)

  const { data: clienteRaw, error: errorCliente } = await service
    .from('clients')
    .select('*')
    .eq('id', clienteId)
    .maybeSingle()

  if (errorCliente) throw errorCliente
  if (!clienteRaw) return { ok: false, estado: 404, mensaje: 'Ese cliente no existe' }

  const cliente = clienteRaw as FilaCliente

  if (!Object.prototype.hasOwnProperty.call(cliente, 'treasury_client_id')) {
    return { ok: false, estado: 503, mensaje: MENSAJE_FALTA_LA_201 }
  }

  const treasuryClientId = cliente.treasury_client_id ?? null
  if (!treasuryClientId) {
    return {
      ok: false,
      estado: 409,
      mensaje:
        `«${cliente.name}» todavía no está emparejado con ningún cliente de Tesorería, así que no ` +
        'hay dónde escribir la comisión. Elígelo en el desplegable de arriba.',
    }
  }

  const { data: destinoRaw, error: errorDestino } = await service
    .from('treasury_clients')
    .select('id, name')
    .eq('id', treasuryClientId)
    .maybeSingle()

  if (errorDestino) throw errorDestino
  if (!destinoRaw) {
    return {
      ok: false,
      estado: 409,
      mensaje:
        'El cliente de Tesorería con el que estaba emparejado ya no existe. Vuelve a elegirlo.',
    }
  }
  const destino = destinoRaw as { id: string; name: string }

  const mesActual = await leerMesDeTesoreria(treasuryClientId, period)

  if (mesActual.facturado) {
    return {
      ok: false,
      estado: 409,
      mensaje:
        `${mesEnLetra(anio, mes)} de «${destino.name}» ya está facturado` +
        (mesActual.numeroFactura ? ` (${mesActual.numeroFactura})` : '') +
        '. La factura guarda sus propios importes, así que cambiar esto ahora no la cambiaría: solo ' +
        'dejaría el ERP diciendo una cifra y el PDF del cliente otra. Si hay que rehacerla, primero ' +
        'se anula la factura en Facturación.',
    }
  }

  // Céntimo: por debajo de medio céntimo no es un cambio, es el redondeo.
  const hayOtro =
    mesActual.commission != null && Math.abs(mesActual.commission - importe) >= 0.005

  if (hayOtro && !confirmar) {
    return {
      ok: false,
      estado: 409,
      mensaje:
        `${mesEnLetra(anio, mes)} de «${destino.name}» ya tenía ${mesActual.commission} € de ` +
        `comisión apuntados y el cálculo dice ${importe} €.`,
      conflicto: { actual: mesActual.commission as number, nuevo: importe },
    }
  }

  /**
   * SELECT y después UPDATE o INSERT, en vez de un upsert.
   *
   * Un upsert obliga a mandar la fila y arrastra `fee` en el cuerpo. Aquí se
   * escribe UNA columna: si la fila existe, `update({ commission })` deja el
   * resto exactamente como estaba.
   */
  const { data: existente, error: errorLectura } = await service
    .from('treasury_client_months')
    .select('id')
    .eq('client_id', treasuryClientId)
    .eq('period', period)
    .maybeSingle()

  if (errorLectura) throw errorLectura

  if (existente) {
    const { error } = await service
      .from('treasury_client_months')
      .update({ commission: importe })
      .eq('id', (existente as { id: string }).id)

    if (error) throw error
  } else {
    const { error } = await service
      .from('treasury_client_months')
      .insert({ client_id: treasuryClientId, period, commission: importe })

    // 23505 = otro lo ha creado entre el select y el insert. Se reintenta como
    // actualización en vez de contestar un error que no le dice nada a nadie.
    if (error?.code === '23505') {
      const { error: errorReintento } = await service
        .from('treasury_client_months')
        .update({ commission: importe })
        .eq('client_id', treasuryClientId)
        .eq('period', period)
      if (errorReintento) throw errorReintento
    } else if (error) {
      throw error
    }
  }

  return {
    ok: true,
    guardado: {
      ok: true,
      clienteTesoreria: destino.name,
      period,
      commission: importe,
      fee: mesActual.fee,
      creada: !existente,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 4) LA PAREJA                                                        */
/* ------------------------------------------------------------------ */

export type ResultadoEnlace =
  | { ok: true }
  | { ok: false; estado: number; mensaje: string }

/**
 * Lo que se contesta cuando esa fila de Tesorería ya la tiene otro. Está en una
 * función porque hay DOS sitios que lo detectan —la comprobación previa y el
 * 23505 del índice— y tienen que decir exactamente lo mismo: si uno de los dos
 * contestara «no se ha podido guardar» a secas, lo siguiente que hace alguien es
 * enlazarlo escribiendo en la tabla y pisar el mes del otro.
 */
function mensajeYaOcupado(nombreOtro: string | null | undefined): string {
  return (
    `Ese cliente de Tesorería ya está emparejado con «${nombreOtro ?? 'otro cliente'}», y una ` +
    'misma fila de Tesorería no puede recibir dos comisiones: solo hay una celda por mes y la ' +
    'segunda borraría a la primera. Es el caso de Ham Master y su cuenta secundaria, que hoy ' +
    'se apañan metiendo una comisión en la columna del fee. Mientras eso no se decida, esa ' +
    'segunda cuenta se sigue apuntando a mano en Tesorería.'
  )
}

/**
 * GUARDA —O QUITA— LA PAREJA cliente de comisiones <-> cliente de Tesorería.
 *
 * `treasuryClientId` a null la deshace, y eso tiene que poder hacerse: una
 * pareja equivocada descubierta a tiempo se quita; una que no se puede quitar
 * acaba corrigiéndose escribiendo a mano en la tabla.
 *
 * EL 23505 NO ES UN ERROR RARO: es el índice único de la 201 diciendo que esa
 * fila de Tesorería ya la tiene otro cliente de comisiones. Pasa de verdad —Ham
 * Master y HamMaster Cuenta secundaria facturan los dos a GFY Logis tic— y hay
 * que contarlo con los dos nombres, porque si se contesta «no se ha podido
 * guardar» a secas, lo siguiente que hace alguien es enlazarlo por la base y
 * pisar el mes del otro.
 */
export async function enlazarConTesoreria(
  clienteId: string,
  treasuryClientId: string | null
): Promise<ResultadoEnlace> {
  const service = createServiceClient()

  if (treasuryClientId) {
    const { data: destino, error } = await service
      .from('treasury_clients')
      .select('id')
      .eq('id', treasuryClientId)
      .maybeSingle()

    if (error) throw error
    if (!destino) return { ok: false, estado: 404, mensaje: 'Ese cliente de Tesorería no existe' }

    /**
     * SE COMPRUEBA AQUÍ ADEMÁS DE EN EL ÍNDICE, Y NO ES UN CINTURÓN DE SOBRA.
     *
     * Lo natural sería fiarlo todo al índice único de la 201 y limitarse a
     * traducir el 23505, que es lo que hace el `catch` de abajo. El problema es
     * que ESE ÍNDICE PUEDE NO EXISTIR, y no por descuido: la propia migración lo
     * crea dentro de un bloque que captura `unique_violation` y sigue adelante
     * con un aviso, para no reventar entera si alguien ya había duplicado un
     * destino a mano. O sea que hay un estado previsto, y documentado allí, en
     * el que la base NO defiende nada.
     *
     * En ese estado, sin esta comprobación, se podrían enlazar Ham Master y su
     * cuenta secundaria a GFY Logis tic, y a partir de ahí el segundo cálculo
     * que se guardara cada mes BORRARÍA la comisión del primero —una sola celda
     * por mes, UNIQUE (client_id, period)—, sin error y sin rastro, hasta que
     * saliera la factura con un número de menos.
     *
     * Así que se pregunta antes. Con índice, esto contesta lo mismo que él y con
     * mejor mensaje; sin índice, es lo único que hay. Dos peticiones a la vez se
     * le siguen escapando —para eso está el índice—, pero eso requiere dos
     * personas emparejando el mismo segundo, y aquí solo hay una.
     */
    const { data: yaLoTiene, error: errorOcupado } = await service
      .from('clients')
      .select('id, name')
      .eq('treasury_client_id', treasuryClientId)
      .neq('id', clienteId)
      .limit(1)

    if (errorOcupado && !faltaLa201(errorOcupado)) throw errorOcupado

    const ocupante = ((yaLoTiene ?? []) as { id: string; name: string }[])[0]
    if (ocupante) {
      return { ok: false, estado: 409, mensaje: mensajeYaOcupado(ocupante.name) }
    }
  }

  const { data, error } = await service
    .from('clients')
    .update({ treasury_client_id: treasuryClientId })
    .eq('id', clienteId)
    .select('id')
    .maybeSingle()

  if (error) {
    if (faltaLa201(error)) return { ok: false, estado: 503, mensaje: MENSAJE_FALTA_LA_201 }

    if (error.code === '23505' && treasuryClientId) {
      const { data: otro } = await service
        .from('clients')
        .select('name')
        .eq('treasury_client_id', treasuryClientId)
        .maybeSingle()

      const nombreOtro = (otro as { name: string } | null)?.name

      return { ok: false, estado: 409, mensaje: mensajeYaOcupado(nombreOtro) }
    }

    throw error
  }

  if (!data) return { ok: false, estado: 404, mensaje: 'Ese cliente no existe' }

  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* 5) EL RESUMEN DE UN MES, PARA LA BARRA DE CLIENTES                  */
/* ------------------------------------------------------------------ */

/**
 * Una sola pasada por todos los clientes para pintar la barra izquierda del panel: qué situación tiene cada uno y cuánta comisión
 * hay ese mes. NO calcula (el cálculo sigue siendo `/api/commissions/process`): enseña lo ya apuntado, que es lo que Raúl validó.
 *
 * De dónde sale la cifra, por orden: la fila de Tesorería si el cliente está emparejado y tiene comisión ese mes (es lo que se va a
 * facturar); si no, el último informe guardado desde la calculadora (`commission_reports`, cuyo `period` es texto: «Octubre 2026»).
 */
export async function leerResumenDelMes(anio: number, mes: number): Promise<ResumenDelMes> {
  const service = createServiceClient()
  const period = periodoDe(anio, mes)

  const { data: filasClientes, error: errorClientes } = await service.from('clients').select('*').order('name', { ascending: true })
  if (errorClientes) throw errorClientes
  const clientes = ((filasClientes ?? []) as (FilaCliente & { base_commission_rate?: number | null })[]).filter(
    (c) => !CLIENTES_FUERA_DEL_PANEL.includes(c.name)
  )

  const hayColumna = clientes.some((c) => Object.prototype.hasOwnProperty.call(c, 'treasury_client_id'))

  /* Tax Reports: quién tiene fichero ese mes y el mismo mes del año pasado */
  const taxDe = new Map<string, string>()
  const ficherosPorTax = new Map<string, { actual?: FilaFichero; anterior?: FilaFichero }>()
  let faltaLa200Aqui = false
  try {
    const { data: tax, error: errorTax } = await service.from('tax_report_clientes').select('id, client_id')
    if (errorTax) throw errorTax
    for (const t of (tax ?? []) as { id: string; client_id: string }[]) taxDe.set(t.client_id, t.id)

    const { data: ficheros, error: errorFicheros } = await service
      .from('tax_report_ficheros')
      .select('id, cliente_id, anio, mes, nombre_original, subido_at, purgado_at')
      .in('anio', [anio, anio - 1])
      .eq('mes', mes)
    if (errorFicheros) throw errorFicheros
    for (const f of (ficheros ?? []) as (FilaFichero & { cliente_id: string })[]) {
      const celda = ficherosPorTax.get(f.cliente_id) ?? {}
      if (f.anio === anio) celda.actual = f
      else celda.anterior = f
      ficherosPorTax.set(f.cliente_id, celda)
    }
  } catch (error) {
    if (!faltaLa200(error)) throw error
    faltaLa200Aqui = true
  }

  /* Tesorería: lo apuntado ese mes y si ya hay factura */
  const mesTesoreria = new Map<string, { fee: number | null; commission: number | null }>()
  const facturados = new Set<string>()
  if (hayColumna) {
    const [meses, facturas] = await Promise.all([
      service.from('treasury_client_months').select('client_id, fee, commission').eq('period', period),
      service.from('invoices').select('treasury_client_id').eq('period', period).neq('status', 'cancelled'),
    ])
    if (meses.error) throw meses.error
    if (facturas.error) throw facturas.error
    for (const m of (meses.data ?? []) as { client_id: string; fee: number | null; commission: number | null }[]) {
      mesTesoreria.set(m.client_id, {
        fee: m.fee != null ? Number(m.fee) : null,
        commission: m.commission != null ? Number(m.commission) : null,
      })
    }
    for (const f of (facturas.data ?? []) as { treasury_client_id: string }[]) facturados.add(f.treasury_client_id)
  }

  /* El último informe guardado de cada cliente para ese mes (texto: «Octubre 2026») */
  const guardados = new Map<string, number>()
  const { data: informes, error: errorInformes } = await service
    .from('commission_reports')
    .select('client_id, data, created_at')
    .eq('period', mesEnLetra(anio, mes))
    .order('created_at', { ascending: false })
  if (errorInformes) throw errorInformes
  for (const r of (informes ?? []) as { client_id: string; data: unknown }[]) {
    if (guardados.has(r.client_id)) continue
    const importe = importeDeCalculo(r.data)
    if (importe != null) guardados.set(r.client_id, importe)
  }

  const resumen: ResumenDeCliente[] = clientes.map((c) => {
    const perfil = perfilDeCalculo(c)
    const taxId = taxDe.get(c.id)
    const celda = taxId ? ficherosPorTax.get(taxId) : undefined
    const treasuryId = hayColumna ? (c.treasury_client_id ?? null) : null

    let situacion: SituacionDelCliente
    if (!taxId) situacion = 'sin_tax_reports'
    else if (!celda?.actual) situacion = 'sin_informe'
    else if (celda.actual.purgado_at) situacion = 'purgado'
    else if (perfil.dosFicheros && (!celda.anterior || celda.anterior.purgado_at)) situacion = 'falta_anterior'
    else situacion = 'listo'

    const tes = treasuryId ? mesTesoreria.get(treasuryId) : undefined
    const guardada = guardados.get(c.id)
    const comision = tes?.commission != null ? tes.commission : (guardada ?? null)
    const origenComision = tes?.commission != null ? 'tesoreria' : guardada != null ? 'informe_guardado' : null

    return {
      id: c.id,
      nombre: c.name,
      tasaBase: c.base_commission_rate != null ? Number(c.base_commission_rate) : null,
      perfil,
      situacion,
      comision,
      origenComision,
      fee: tes?.fee ?? null,
      facturado: treasuryId ? facturados.has(treasuryId) : false,
      enlazado: Boolean(treasuryId),
    }
  })

  return {
    anio,
    mes,
    period,
    clientes: resumen,
    totalComision: resumen.reduce((s, c) => s + (c.comision ?? 0), 0),
    faltaMigracion: faltaLa200Aqui ? '200' : hayColumna ? false : '201',
  }
}
