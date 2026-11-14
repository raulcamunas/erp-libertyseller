/**
 * LA LISTA DE COMPROBACIÓN PARA DEJAR NOTION — PURO.
 *
 * Antes de pasar Notion a «solo lectura» hay que estar seguro de que el ERP hace todo lo que Notion hacía. Parte de esa seguridad se MIDE (la sincronización corre sola, no hay envíos
 * atascados, lo que se crea aquí llega a Notion, el equipo trabaja aquí…) y parte solo la puede confirmar una persona mirando (que una tabla creada aquí se ve bien en Notion, que nadie
 * echa nada en falta). Las medidas las recoge salida-servidor.ts; aquí viven las reglas que las convierten en ✓ / ✗ y la cuenta final.
 */

export interface Metricas {
  notionConfigurado: boolean
  escrituraActiva: boolean
  clientesConNotion: number
  clientesConError: number
  /** Cuándo acabó bien la última pasada del cron de Notion (ISO), o null si no hay ninguna */
  cronUltimoOk: string | null
  colaPendiente: number
  colaAtascada: number
  eventosDelWebhook24h: number
  /** Tareas creadas en el ERP que ya están en Notion y enviadas sin error, y las que tienen error */
  tareasDelErpEnviadas: number
  tareasDelErpConError: number
  /** De esas enviadas, cuántas llevan una tabla, una imagen o un desplegable */
  conTabla: number
  conImagen: number
  conDesplegable: number
  /** Personas con al menos 10 acciones en los últimos 7 días */
  personasActivas7d: number
  dispositivosPush: number
  reunionesAnalizadas: number
  propuestasAceptadas: number
  /** Las tablas de las migraciones 275–280 que todavía no existen */
  tablasQueFaltan: string[]
}

export type EstadoDeComprobacion = 'ok' | 'falta' | 'aviso'

export interface Comprobacion {
  clave: string
  grupo: 'conexion' | 'envio' | 'equipo'
  titulo: string
  estado: EstadoDeComprobacion
  /** Lo que se ha medido, en una frase */
  detalle: string
  /** Qué hacer si no está en verde */
  ayuda?: string
}

export const MINUTOS_SIN_PASADA = 10
const minutosDesde = (iso: string, ahora: number) => Math.round((ahora - Date.parse(iso)) / 60_000)
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export function evaluar(m: Metricas, ahora: number = Date.now()): Comprobacion[] {
  const falta = (tipos: Array<[number, string]>) => tipos.filter(([n]) => n < 1).map(([, t]) => t)
  const sinContenido = falta([[m.conTabla, 'una tabla'], [m.conImagen, 'una imagen'], [m.conDesplegable, 'un desplegable']])
  const minutos = m.cronUltimoOk ? minutosDesde(m.cronUltimoOk, ahora) : null
  return [
    {
      clave: 'escritura',
      grupo: 'conexion',
      titulo: 'El ERP está conectado a Notion y escribe en él',
      estado: m.notionConfigurado && m.escrituraActiva ? 'ok' : 'falta',
      detalle: !m.notionConfigurado ? 'Falta la clave de Notion en el servidor' : !m.escrituraActiva ? 'La escritura a Notion está apagada (NOTION_ESCRITURA=0)' : `Conectado y escribiendo en ${plural(m.clientesConNotion, 'cliente', 'clientes')}`,
      ayuda: 'Revisa NOTION_TOKEN y que NOTION_ESCRITURA no valga 0 en Easypanel.',
    },
    {
      clave: 'sincroniza_sola',
      grupo: 'conexion',
      titulo: 'La sincronización corre sola, sin que nadie la lance',
      estado: minutos !== null && minutos <= MINUTOS_SIN_PASADA ? 'ok' : 'falta',
      detalle: minutos === null ? 'No hay ninguna pasada registrada' : `La última acabó bien hace ${minutos} min`,
      ayuda: 'Mira en Sistema el proceso «Tareas de clientes con Notion»: si no corre, el crontab del contenedor no lo está lanzando.',
    },
    {
      clave: 'sin_errores',
      grupo: 'conexion',
      titulo: 'Ningún cliente con error de sincronización',
      estado: m.clientesConError === 0 ? 'ok' : 'falta',
      detalle: m.clientesConError === 0 ? 'Todos los clientes sincronizan bien' : `${plural(m.clientesConError, 'cliente con error', 'clientes con error')}`,
      ayuda: 'En el inicio, la tarjeta del cliente dice «con problemas de sincronización».',
    },
    {
      clave: 'cola_limpia',
      grupo: 'conexion',
      titulo: 'No hay cambios atascados esperando salir hacia Notion',
      estado: m.colaAtascada === 0 && m.colaPendiente <= 10 ? 'ok' : 'falta',
      detalle: m.colaAtascada > 0 ? `${plural(m.colaAtascada, 'cambio atascado', 'cambios atascados')} tras varios intentos` : `${plural(m.colaPendiente, 'cambio esperando', 'cambios esperando')}`,
      ayuda: 'Un cambio atascado es un fallo de Notion (permisos, una opción que no existe…): en la tarea sale el motivo.',
    },
    {
      clave: 'webhook',
      grupo: 'conexion',
      titulo: 'Notion avisa en directo de lo que se cambia allí',
      estado: m.eventosDelWebhook24h > 0 ? 'ok' : 'aviso',
      detalle: m.eventosDelWebhook24h > 0 ? `${plural(m.eventosDelWebhook24h, 'aviso recibido', 'avisos recibidos')} en las últimas 24 h` : 'Ningún aviso en 24 h (puede ser un día sin cambios en Notion; la pasada periódica lo recoge igual)',
    },
    {
      clave: 'tareas_enviadas',
      grupo: 'envio',
      titulo: 'Lo que se crea en el ERP llega a Notion sin errores',
      estado: m.tareasDelErpEnviadas >= 5 && m.tareasDelErpConError === 0 ? 'ok' : m.tareasDelErpConError > 0 ? 'falta' : 'aviso',
      detalle: m.tareasDelErpConError > 0 ? `${plural(m.tareasDelErpConError, 'tarea con error', 'tareas con error')} al enviarse` : `${plural(m.tareasDelErpEnviadas, 'tarea creada aquí enviada', 'tareas creadas aquí enviadas')} sin error (hacen falta 5)`,
      ayuda: 'Crea unas cuantas tareas en el ERP y comprueba que aparecen en Notion.',
    },
    {
      clave: 'contenido_rico',
      grupo: 'envio',
      titulo: 'Tablas, imágenes y desplegables también llegan a Notion',
      estado: sinContenido.length === 0 ? 'ok' : 'falta',
      detalle: sinContenido.length === 0 ? 'Hay tareas con los tres tipos ya enviadas sin error' : `Todavía no hay ninguna tarea creada aquí con ${sinContenido.join(', ')} enviada a Notion`,
      ayuda: 'Crea una tarea de prueba con una tabla, una imagen y un desplegable, espera un minuto y ábrela en Notion.',
    },
    {
      clave: 'equipo_usa',
      grupo: 'equipo',
      titulo: 'El equipo trabaja de verdad desde el ERP',
      estado: m.personasActivas7d >= 3 ? 'ok' : m.personasActivas7d >= 1 ? 'aviso' : 'falta',
      detalle: `${plural(m.personasActivas7d, 'persona ha hecho', 'personas han hecho')} 10 o más cambios esta semana (hacen falta 3)`,
    },
    {
      clave: 'push',
      grupo: 'equipo',
      titulo: 'Los avisos al móvil están activados',
      estado: m.dispositivosPush >= 2 ? 'ok' : m.dispositivosPush === 1 ? 'aviso' : 'falta',
      detalle: `${plural(m.dispositivosPush, 'dispositivo activado', 'dispositivos activados')} (hacen falta 2)`,
      ayuda: 'En «Mi día» → Avisos → Activar, desde el móvil o la app del Mac.',
    },
    {
      clave: 'propuestas',
      grupo: 'equipo',
      titulo: 'Las tareas de las reuniones nacen en el ERP',
      estado: m.reunionesAnalizadas >= 1 && m.propuestasAceptadas >= 1 ? 'ok' : m.reunionesAnalizadas >= 1 ? 'aviso' : 'falta',
      detalle: `${plural(m.reunionesAnalizadas, 'reunión analizada', 'reuniones analizadas')} desde el 9 nov · ${plural(m.propuestasAceptadas, 'propuesta aceptada', 'propuestas aceptadas')}`,
      ayuda: 'Hace falta una reunión de seguimiento con un cliente y aceptar alguna de sus propuestas.',
    },
    {
      clave: 'migraciones',
      grupo: 'equipo',
      titulo: 'Todas las migraciones están lanzadas',
      estado: m.tablasQueFaltan.length === 0 ? 'ok' : 'falta',
      detalle: m.tablasQueFaltan.length === 0 ? 'Existen todas las tablas de las migraciones 275 a 280' : `Faltan: ${m.tablasQueFaltan.join(', ')}`,
    },
  ]
}

export interface ComprobacionManual {
  clave: string
  titulo: string
  descripcion: string
  /** Es el último paso: solo se hace cuando todo lo demás está */
  final?: boolean
}

export const COMPROBACIONES_MANUALES: readonly ComprobacionManual[] = [
  { clave: 'm_vista_en_notion', titulo: 'Una tarea con tabla, imagen y desplegable creada en el ERP se ve bien en Notion', descripcion: 'Ábrela en Notion y mira que la tabla, la imagen y el desplegable están como en el ERP.' },
  { clave: 'm_al_reves', titulo: 'Lo que se cambia en Notion llega al ERP (estado, responsable, fecha y cuerpo)', descripcion: 'Cambia algo en una tarea desde Notion y comprueba que en el ERP se ve en un par de minutos.' },
  { clave: 'm_presencia', titulo: 'La presencia y los avisos laterales funcionan con dos personas a la vez', descripcion: 'Abre el inicio con un compañero: tiene que salir «1 en línea», y su comentario tiene que saltar abajo a la derecha.' },
  { clave: 'm_equipo', titulo: 'Se lo he preguntado al equipo y nadie echa en falta nada de Notion', descripcion: 'Que cada persona diga si hay algo que hacía en Notion y aquí no puede hacer.' },
  { clave: 'm_rutinas', titulo: 'Las rutinas de Claude que escribían en Notion están apagadas', descripcion: 'Notas de Gemini → tableros Notion (14:00 y 21:00) y Meet transcript to notion.' },
  { clave: 'm_copia', titulo: 'He exportado una copia completa de Notion', descripcion: 'Ajustes → Exportar contenido de todo el espacio, y guardarla.' },
  { clave: 'm_fecha', titulo: 'He avisado al equipo del día en que Notion pasa a solo lectura', descripcion: 'Con unos días de margen, para que nadie siga escribiendo allí por costumbre.' },
  { clave: 'm_solo_lectura', titulo: 'Notion está en solo lectura', descripcion: 'Quitar la edición a todo el equipo en Notion, sin borrar nada: queda como archivo. El ERP deja de necesitar escribir allí.', final: true },
]

export interface ResumenDeSalida {
  hechas: number
  total: number
  /** Todo lo demás está en verde y solo falta el paso final */
  listo: boolean
  /** Está todo, incluido el paso final */
  terminada: boolean
}

export function resumir(auto: readonly Comprobacion[], manuales: ReadonlyArray<{ clave: string; hecho: boolean }>): ResumenDeSalida {
  const manualesPorClave = new Map(manuales.map((m) => [m.clave, m.hecho]))
  const finales = new Set(COMPROBACIONES_MANUALES.filter((c) => c.final).map((c) => c.clave))
  // Un «aviso» no impide salir (es información), una cosa que falta sí
  const autoBien = auto.filter((c) => c.estado !== 'falta').length
  const manualesBien = COMPROBACIONES_MANUALES.filter((c) => manualesPorClave.get(c.clave) === true).length
  const total = auto.length + COMPROBACIONES_MANUALES.length
  const hechas = autoBien + manualesBien
  const previoListo = auto.every((c) => c.estado !== 'falta') && COMPROBACIONES_MANUALES.filter((c) => !finales.has(c.clave)).every((c) => manualesPorClave.get(c.clave) === true)
  return { hechas, total, listo: previoListo, terminada: previoListo && [...finales].every((c) => manualesPorClave.get(c) === true) }
}

/** Qué se guarda en la tabla de ajustes (clave → 1 o 0): `tc_salida_<clave>` */
export const claveDeAjuste = (clave: string): string => `tc_salida_${clave}`
export const esClaveManual = (clave: unknown): clave is string => typeof clave === 'string' && COMPROBACIONES_MANUALES.some((c) => c.clave === clave)
