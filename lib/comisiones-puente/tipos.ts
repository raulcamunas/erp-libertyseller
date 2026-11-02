import { normalizarNombre } from '@/lib/facturacion/tipos'

/**
 * EL PUENTE ENTRE EL CÁLCULO DE LA COMISIÓN Y TESORERÍA — TIPOS Y CUENTAS.
 * ========================================================================
 *
 * Este fichero es TIPOS Y FUNCIONES PURAS. No toca la base, no importa nada de
 * `lib/supabase` y por eso lo puede importar la pantalla sin arrastrar la clave
 * de servicio al JavaScript que se descarga cualquiera. Es el mismo reparto que
 * hay en Tax Reports entre `tipos.ts` y `datos.ts`, y por el mismo motivo: aquí
 * dentro NO puede entrar nunca un `import` de datos.ts.
 *
 *
 * ============ QUÉ RESUELVE EL MÓDULO, EN UNA FRASE ============
 *
 * El día 4: se elige un cliente y un mes, el ERP coge el fichero que el empleado
 * dejó el día 3 en Tax Reports, se calcula la comisión CON LA CALCULADORA DE
 * SIEMPRE, se enseña, y cuando Raúl la valida se escribe en Tesorería. El `fee`
 * lo sigue poniendo él a mano y aquí no se toca nunca.
 *
 *
 * ============ LA REGLA NÚMERO UNO: EL CÁLCULO NO SE TOCA ============
 *
 * `app/api/commissions/process/route.ts` son 1.386 líneas de las que salen las
 * facturas de verdad, con casos escritos a mano cliente por cliente (ShoesF y
 * Farmacia Garrachon comparan dos años, Keslem parte por marca con su catálogo,
 * SHOPLAMP lleva baseline, DIRU/SAUSI/Creative Toys van por Net profit,
 * HamMaster secundaria filtra 31 ASIN concretos). No hay ni un test que cubra
 * eso, y un error al moverlo de sitio no da error: da un número distinto, ya
 * facturado, que nadie mira.
 *
 * Así que este módulo NO copia, NO importa y NO reescribe nada de ese cálculo.
 * Lo llama por donde ya se le llama once veces al mes: un POST de FormData a
 * `/api/commissions/process` desde el navegador. Lo único que cambia es de dónde
 * sale el fichero —de Tax Reports en vez del escritorio de alguien— y qué se
 * hace con el número de después.
 */

/* ------------------------------------------------------------------ */
/* EL MES                                                              */
/* ------------------------------------------------------------------ */

export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const

/**
 * EL MES SE MANEJA SIEMPRE COMO (año, mes) Y SE ESCRIBE COMO DATE DE DÍA 1.
 *
 * Las dos tablas de destino no usan el mismo formato y eso ya ha mordido:
 * `commission_reports.period` es TEXTO LIBRE en español —hay filas con
 * «Septiembre 2026», con «Agosto 2026» y al menos una con la cadena vacía—,
 * mientras que `treasury_client_months.period` es DATE a día 1 y
 * `app/api/facturacion/emitir` exige `/^\d{4}-\d{2}-01$/`.
 *
 * O sea que el texto se puede sacar del DATE, pero del texto no se puede sacar
 * el DATE con seguridad. Por eso aquí el mes viaja como dos números y el texto
 * se compone al final, nunca al revés.
 */
export function periodoDe(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-01`
}

/** «Septiembre 2026». Para las pantallas y para el informe guardado. */
export function mesEnLetra(anio: number, mes: number): string {
  return `${MESES[mes - 1] ?? '?'} ${anio}`
}

/* ------------------------------------------------------------------ */
/* QUÉ NECESITA CADA CLIENTE PARA CALCULAR                             */
/* ------------------------------------------------------------------ */

/** Lo poco de `public.clients` que hace falta para saber cómo se calcula */
export interface ClienteDeComisiones {
  id: string
  name: string
  marca_propia?: string | null
  tasa_marca_propia?: number | null
  modo_calculo?: 'facturacion' | 'beneficio' | null
}

/**
 * Lo que la pantalla tiene que pedir antes de poder llamar al cálculo.
 *
 * `dosFicheros` NO son dos meses: son EL MISMO MES DE DOS AÑOS. Se compara el
 * excedente del año actual contra el del anterior. Es la confusión más fácil de
 * cometer aquí y la que haría facturar un excedente inventado.
 */
export interface PerfilDeCalculo {
  /** Compara dos años: hacen falta el fichero de este año y el del pasado */
  dosFicheros: boolean
  /** Keslem: además parte la comisión por marca y devuelve OTRO JSON */
  porMarca: boolean
  /** ShoesF: se puede forzar la tasa, en PORCENTAJE ('3' = 3 %) */
  admiteTasaManual: boolean
  /** SAUSI: hay que elegir 15 % o 35 % del beneficio antes de calcular */
  pideTramoBeneficio: boolean
}

/**
 * LA MISMA REGLA QUE APLICA EL CÁLCULO, REPETIDA AQUÍ. Y SÍ, ES UNA COPIA.
 *
 * `app/api/commissions/process/route.ts` decide con esto mismo en su línea 63 y
 * su línea 70, y `components/commissions/CommissionsCalculator.tsx` lo repite en
 * su línea 95. Este es el TERCER sitio, y la alternativa —sacarlo a una función
 * compartida— obligaría a editar el fichero del cálculo, que es justo lo único
 * que no se puede tocar en este encargo.
 *
 * Si algún día se unifica, se unifica en los tres a la vez. Y mientras tanto:
 * SI ALGUIEN CAMBIA LA REGLA ALLÍ Y NO AQUÍ, esta pantalla pedirá un fichero de
 * menos o de más y el cálculo contestará «Se requieren ambos archivos CSV»
 * teniéndolos delante — que es exactamente el error que ya pasó una vez con
 * Keslem y está documentado en el propio route.ts.
 */
export function perfilDeCalculo(cliente: ClienteDeComisiones): PerfilDeCalculo {
  const esShoesF = cliente.name === 'ShoesF' || cliente.name === 'Farmacia Garrachon'
  const porMarca = Boolean(cliente.marca_propia && cliente.tasa_marca_propia != null)

  return {
    dosFicheros: esShoesF || porMarca,
    porMarca,
    admiteTasaManual: esShoesF,
    pideTramoBeneficio: cliente.name === 'SAUSI',
  }
}

/* ------------------------------------------------------------------ */
/* DE DÓNDE SE SACA EL IMPORTE QUE SE VA A GUARDAR                     */
/* ------------------------------------------------------------------ */

/**
 * EL CÁLCULO DEVUELVE DOS FORMAS DE `data` DISTINTAS, Y ESTO ES LO QUE MÁS
 * FÁCIL SE ROMPE DE TODO EL PUENTE.
 *
 *   (A) Camino normal —y ShoesF, y SHOPLAMP, y los de beneficio—:
 *       `data.summary.totalCommission`, sin redondear (198.3225000000002).
 *
 *   (B) Camino por marca (Keslem): `data` NO TIENE `summary`. Sus claves son
 *       modo, cliente, marca, catalogoReferencias, bloques[], sinUbicar y
 *       `totalComision`, ya redondeado a dos decimales.
 *
 * Una pantalla que leyera `data.summary.totalCommission` para todos le pondría
 * `undefined` a Keslem y guardaría 0 en Tesorería para el cliente cuyo cálculo
 * es el más complicado del módulo — sin ningún error, con el botón en verde.
 *
 * Se distinguen por `data.modo === 'por_marca'`, que es lo que el propio
 * cálculo escribe. Devuelve `null` si no se reconoce ninguna de las dos formas:
 * más vale no dejar guardar que guardar un cero.
 *
 * Y SE REDONDEA A DOS DECIMALES AQUÍ, una sola vez. `treasury_client_months.
 * commission` es NUMERIC y la factura se monta con ese valor tal cual: guardar
 * 198.3225000000002 significa que el PDF y el correo dicen dos cosas distintas
 * según quién redondee.
 */
export function importeDeCalculo(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  const crudo =
    d.modo === 'por_marca'
      ? d.totalComision
      : (d.summary as Record<string, unknown> | undefined)?.totalCommission

  if (typeof crudo !== 'number' || !Number.isFinite(crudo)) return null
  return Math.round(crudo * 100) / 100
}

/** Si el resultado que hay en pantalla vino del camino de Keslem */
export function esResultadoPorMarca(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && (data as { modo?: string }).modo === 'por_marca')
}

/* ------------------------------------------------------------------ */
/* LO QUE VIAJA ENTRE LAS RUTAS Y LA PANTALLA                          */
/* ------------------------------------------------------------------ */

/** Una celda de Tax Reports, sin nada de dentro del fichero */
export interface FicheroDelMes {
  id: string
  anio: number
  mes: number
  nombreOriginal: string
  subidoAt: string
  /** Retirado a los 183 días. La fila sigue, el fichero no */
  purgado: boolean
}

/** Un candidato a pareja, con lo justo para reconocerlo de un vistazo */
export interface CandidatoTesoreria {
  id: string
  nombre: string
  activo: boolean
  /** true = el nombre normalizado coincide. Es una pista, no una decisión */
  seParece: boolean
  /** Ya lo tiene enlazado OTRO cliente de comisiones: no se puede elegir */
  ocupadoPor: string | null
  /** Los tres últimos meses con algo apuntado: «sep 2026 · fee 700 · com 175» */
  ultimosMeses: { period: string; fee: number | null; commission: number | null }[]
}

/** Lo que Tesorería tiene apuntado HOY para ese cliente y ese mes */
export interface MesDeTesoreria {
  period: string
  fee: number | null
  commission: number | null
  /** Ya hay factura viva de ese mes: el importe no se puede cambiar */
  facturado: boolean
  numeroFactura: string | null
}

/** La respuesta del GET: todo lo que la pantalla necesita saber del mes */
export interface EstadoDelMes {
  cliente: {
    id: string
    nombre: string
    perfil: PerfilDeCalculo
    marcaPropia: string | null
  }
  enlace: {
    treasuryClientId: string | null
    nombre: string | null
    candidatos: CandidatoTesoreria[]
  }
  anio: number
  mes: number
  period: string
  /** El del mes pedido */
  ficheroActual: FicheroDelMes | null
  /** El MISMO MES DEL AÑO ANTERIOR. Solo para los que comparan dos años */
  ficheroAnterior: FicheroDelMes | null
  /** Qué falta, ya escrito en español para enseñarlo tal cual */
  faltan: string[]
  /** Lo que hay que subir a mano porque Tax Reports no lo puede dar */
  aMano: CampoDeFichero[]
  puedeCalcular: boolean
  tesoreria: MesDeTesoreria | null
  /** true = falta pegar la 200 o la 201 en el editor SQL de Supabase */
  faltaMigracion: false | '200' | '201'
}

/** Los tres nombres de campo que entiende /api/commissions/process */
export type CampoDeFichero = 'file' | 'filePreviousYear' | 'fileCurrentYear'

/** Un fichero que la pantalla tiene que bajar y volver a mandar */
export interface DescargaPlanificada {
  campo: CampoDeFichero
  ficheroId: string
  nombre: string
  /** Enlace firmado de 60 segundos. No se guarda en ningún sitio */
  url: string
}

/**
 * EL PLAN DE LA LLAMADA AL CÁLCULO.
 *
 * Ver la cabecera de `app/api/comisiones-puente/calcular/route.ts` para el
 * porqué de que esto sea un plan y no un resultado: el POST al cálculo lo hace
 * el navegador, exactamente igual que lleva haciéndolo la calculadora de
 * siempre, y así no hay que tocar ni una línea de las 1.386.
 */
export interface PlanDeCalculo {
  /** El `clientId` de public.clients que espera el FormData */
  clientId: string
  descargas: DescargaPlanificada[]
  /** Campos que el admin tiene que adjuntar él: el año anterior, casi siempre */
  aMano: CampoDeFichero[]
  /** Campos de texto del FormData: manualCommissionRate, benefitRate */
  extras: Record<string, string>
  /** Para pintar el aviso de Keslem antes de mirar el número */
  porMarca: boolean
}

/** Lo que contesta el guardado cuando hay que preguntar antes de pisar */
export interface ConflictoDeGuardado {
  /** Lo que ya había escrito en Tesorería */
  actual: number
  /** Lo que se iba a escribir */
  nuevo: number
}

export interface GuardadoHecho {
  ok: true
  /** En qué cliente de Tesorería y en qué mes se ha escrito */
  clienteTesoreria: string
  period: string
  commission: number
  /** El fee que había puesto Raúl. Se devuelve para enseñarlo, NO se toca */
  fee: number | null
  /** true = la fila no existía y se ha creado */
  creada: boolean
}

/** El parecido por nombre, con el mismo normalizado que la migración 163 */
export function seParecen(a: string, b: string): boolean {
  return normalizarNombre(a) === normalizarNombre(b)
}

/* ------------------------------------------------------------------ */
/* EL RESUMEN DE UN MES: TODOS LOS CLIENTES DE UN VISTAZO              */
/* ------------------------------------------------------------------ */

/**
 * En qué punto está cada cliente para el mes elegido, de lo que falta a lo que ya está.
 * `falta_anterior` NO bloquea: los clientes que comparan dos años necesitan el informe del mismo mes del año pasado y Tax Reports
 * no lo guarda (UNIQUE por mes + purga a los 183 días), así que se sube a mano en el propio panel.
 */
export type SituacionDelCliente = 'sin_regla' | 'sin_tax_reports' | 'sin_informe' | 'purgado' | 'falta_anterior' | 'listo'

/** Una cuenta que forma parte de un cliente agrupado (Ham Master = TapasParty + PokerShop) */
export interface MiembroDeGrupo {
  id: string
  nombre: string
  /** Cómo se llama la cuenta en la pantalla: «TapasParty», «PokerShop» */
  etiqueta: string
  situacion: SituacionDelCliente
  comision: number | null
}

export interface ResumenDeCliente {
  id: string
  nombre: string
  /** La tasa pactada, en fracción (0.05 = 5 %) */
  tasaBase: number | null
  perfil: PerfilDeCalculo
  situacion: SituacionDelCliente
  /** Lo que hay de comisión ese mes: la de Tesorería si está emparejado y apuntada; si no, la del último informe guardado */
  comision: number | null
  origenComision: 'tesoreria' | 'informe_guardado' | null
  fee: number | null
  /** Ya hay factura viva de ese mes en Tesorería */
  facturado: boolean
  /** Tiene pareja en Tesorería (migración 201) */
  enlazado: boolean
  /**
   * Cliente que solo existe en Tesorería: todavía no tiene regla de cálculo en el panel. Se enseña lo que Tesorería tiene apuntado (fee,
   * comisión y los últimos meses) y se calculará cuando Raúl diga cómo. El `id` es el de `treasury_clients`, NO el de `clients`.
   */
  soloTesoreria?: { ultimosMeses: { period: string; fee: number | null; commission: number | null }[]; activo: boolean }
  /** Si es un cliente agrupado: sus cuentas, la PRINCIPAL la primera (es la que se empareja con Tesorería y la que guarda la suma) */
  miembros?: MiembroDeGrupo[]
}

export interface ResumenDelMes {
  anio: number
  mes: number
  period: string
  clientes: ResumenDeCliente[]
  /** Suma de las comisiones que hay apuntadas ese mes */
  totalComision: number
  faltaMigracion: false | '200' | '201'
}

/** Clientes que no salen en el panel ni en la calculadora (Raúl, 2 nov 2026: Bodegas Valhalla, DIRU y SAUSI). Solo se esconden: nada se borra de la base */
export const CLIENTES_FUERA_DEL_PANEL = ['Bodegas Valhalla', 'DIRU', 'SAUSI']

/**
 * CLIENTES QUE SE LIQUIDAN JUNTOS: UNA SOLA FILA EN TESORERÍA, VARIAS CUENTAS DE AMAZON.
 * Ham Master (2 nov 2026, Raúl): «agrupa la comisión de estas dos, o sea la suma». TapasParty y PokerShop son dos cuentas, con dos
 * informes y dos cálculos, que se facturan a una sola sociedad. En el panel salen como UN cliente; se calcula cada cuenta y se guarda
 * en Tesorería la SUMA, en la columna de comisión, con el cliente PRINCIPAL (el único emparejado: el índice único de la 201 impide
 * que dos clientes apunten a la misma fila). Los nombres son los de `public.clients`.
 */
export const GRUPOS_DE_CLIENTES: { nombre: string; principal: { nombre: string; etiqueta: string }; otros: { nombre: string; etiqueta: string }[] }[] = [
  {
    nombre: 'Ham Master',
    principal: { nombre: 'Ham Master', etiqueta: 'TapasParty' },
    otros: [{ nombre: 'HamMaster Cuenta secundaria', etiqueta: 'PokerShop' }],
  },
]

/**
 * PAREJAS YA CONOCIDAS ENTRE UN CLIENTE DE COMISIONES Y SU FILA DE TESORERÍA, aunque todavía no se hayan emparejado en el panel.
 * Salen del análisis de la migración 201 (los nombres de las dos listas no se parecen). Sirven SOLO para no enseñar a la misma empresa dos
 * veces —y no sumar su comisión dos veces— en la barra del panel: NO escriben ningún enlace, que se sigue eligiendo a mano al calcular.
 * `tesoreria` es el principio del nombre normalizado de la fila de Tesorería.
 */
export const PAREJAS_CONOCIDAS: { comisiones: string; tesoreria: string }[] = [
  { comisiones: 'Farmacia Garrachon', tesoreria: 'eduardo gomez' },
  { comisiones: 'Lenobotics', tesoreria: 'ocio global import' },
  { comisiones: 'ShoesF', tesoreria: 'zapaterias basoco' },
  { comisiones: 'Ham Master', tesoreria: 'gfy logis' },
]
