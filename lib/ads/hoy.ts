/**
 * AMAZON ADS · «QUÉ HACER HOY» EN UNA CUENTA. PURO: de las propuestas pendientes y del estado de la cuenta sale una lista corta de tareas, ordenada por lo que más dinero mueve o más bloquea.
 *
 * Es la primera tarjeta que ve el administrativo al abrir «Propuestas»: no tiene que leer cuarenta filas para saber por dónde empezar. Cada tarea dice qué hacer, por qué (las cifras) y adónde ir
 * (un filtro de la lista o una pestaña). Lo que impide al motor trabajar (productos sin ACoS objetivo o sin precio, términos sin leer, ficha sin firmar) va antes que las propuestas: sin eso, la
 * lista de propuestas está incompleta y no lo parece.
 */

import type { TipoDePropuesta } from './reglas'

export interface PropuestaParaHoy {
  tipo: TipoDePropuesta
  estado: string
  valorActual: number | null
  valorNuevo: number | null
  haciaCampaignId: string | null
  haciaRol: string | null
  metricas: { gasto: number; ventas: number; pedidos: number; precioEstimado?: number }
}

export type FiltroDePropuestas = 'todas' | 'negativizar' | 'promover' | 'subir-puja' | 'bajar-puja' | 'pausar' | 'presupuesto' | 'error'

export interface TareaDeHoy {
  id: string
  /** alta = bloquea o pierde dinero; media = mejora; info = contexto */
  prioridad: 'alta' | 'media' | 'info'
  titulo: string
  detalle: string
  /** Adónde lleva el botón de la tarea */
  ir?: { filtro: FiltroDePropuestas } | { pestana: 'productos' | 'ficha' | 'crear' } | { accion: 'actualizar-terminos' }
  textoBoton?: string
}

export interface EstadoParaHoy {
  modo: 'apagado' | 'sugiere' | 'aprueba' | 'autopiloto'
  firmada: boolean
  terminos: { actualizadoAt: string | null; filas: number; sincronizando: boolean; error: string | null }
  sinAcos: Array<{ asin: string; resumen: string }>
  sinPrecio: Array<{ asin: string; resumen: string }>
  conPrecioEstimado: Array<{ asin: string; resumen: string; precio: number }>
  /** ASIN con campañas que gastan y que no están en Productos */
  sinFicha?: string[]
  /** El motor no ha podido guardar alguna pausa por falta de la migración 305 */
  faltaMigracionPausas?: boolean
}

const dinero = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const lista = (xs: Array<{ resumen: string }>, max = 3) => xs.slice(0, max).map((x) => x.resumen).join(', ') + (xs.length > max ? ` y ${xs.length - max} más` : '')
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** El filtro al que pertenece una propuesta (el mismo que usan los botones de la lista) */
export function filtroDe(p: Pick<PropuestaParaHoy, 'tipo' | 'estado' | 'valorActual' | 'valorNuevo'>): Exclude<FiltroDePropuestas, 'todas'> {
  if (p.estado === 'error') return 'error'
  if (p.tipo === 'puja') return (p.valorNuevo ?? 0) >= (p.valorActual ?? 0) ? 'subir-puja' : 'bajar-puja'
  return p.tipo
}

export interface ResumenDeHoy {
  tareas: TareaDeHoy[]
  /** Lo que se ha gastado sin vender en lo que se propone negativizar o pausar (en su ventana de lectura): el dinero que se deja de tirar si se aprueba */
  gastoSinVentaRecuperable: number
  pendientes: number
}

export function resumenDeHoy(propuestas: readonly PropuestaParaHoy[], e: EstadoParaHoy, ahora: number): ResumenDeHoy {
  const tareas: TareaDeHoy[] = []
  const pendientes = propuestas.filter((p) => p.estado === 'pendiente' || p.estado === 'error')
  const de = (f: FiltroDePropuestas) => pendientes.filter((p) => filtroDe(p) === f)

  if (e.modo === 'apagado') {
    return { tareas: [{ id: 'apagado', prioridad: 'info', titulo: 'El motor está apagado en esta cuenta', detalle: 'Ponlo en «Solo sugiere» para que lea los términos y proponga cambios sin tocar nada en Amazon.' }], gastoSinVentaRecuperable: 0, pendientes: 0 }
  }

  // ---- lo que impide al motor ver la cuenta entera ----
  if (e.sinFicha && e.sinFicha.length > 0) {
    tareas.push({ id: 'sin-ficha', prioridad: 'alta', titulo: `${plural(e.sinFicha.length, 'producto con campañas no está', 'productos con campañas no están')} en Productos`, detalle: `${e.sinFicha.slice(0, 3).join(', ')}${e.sinFicha.length > 3 ? ` y ${e.sinFicha.length - 3} más` : ''}: gastan en publicidad pero el motor no los mira hasta que se añadan con su ACoS objetivo.`, ir: { pestana: 'productos' }, textoBoton: 'Añadirlos' })
  }
  if (e.sinAcos.length > 0) {
    tareas.push({ id: 'sin-acos', prioridad: 'alta', titulo: `${plural(e.sinAcos.length, 'producto sin', 'productos sin')} ACoS objetivo`, detalle: `${lista(e.sinAcos)}: el motor no les propone nada hasta que tengan su objetivo.`, ir: { pestana: 'productos' }, textoBoton: 'Ir a Productos' })
  }
  if (e.sinPrecio.length > 0) {
    tareas.push({ id: 'sin-precio', prioridad: 'alta', titulo: `${plural(e.sinPrecio.length, 'producto sin', 'productos sin')} precio`, detalle: `${lista(e.sinPrecio)}: no tienen precio en su ficha ni ventas de Ads de las que estimarlo, así que no se sabe cuánto pueden gastar sin vender. Escribe el precio de venta.`, ir: { pestana: 'productos' }, textoBoton: 'Poner el precio' })
  }
  const horas = e.terminos.actualizadoAt ? (ahora - Date.parse(e.terminos.actualizadoAt)) / 3_600_000 : null
  if (!e.terminos.sincronizando && (horas === null || horas > 36)) {
    tareas.push({
      id: 'terminos',
      prioridad: 'alta',
      titulo: horas === null ? 'Todavía no se han leído los términos de búsqueda' : `Los términos tienen ${Math.floor(horas / 24) >= 1 ? plural(Math.floor(horas / 24), 'día', 'días') : `${Math.round(horas)} h`}`,
      detalle: `${e.terminos.error ? `La última lectura falló (${e.terminos.error.slice(0, 120)}). ` : ''}Sin términos recientes no se pueden negativizar ni cosechar. Se leen solos una vez al día.`,
      ir: { accion: 'actualizar-terminos' },
      textoBoton: 'Pedirlos ahora',
    })
  }

  // ---- las propuestas, de lo que más dinero ahorra a lo que más ventas trae ----
  const negativas = de('negativizar')
  const pausas = de('pausar')
  const recuperable = [...negativas, ...pausas].reduce((s, p) => s + (Number(p.metricas.gasto) || 0), 0)
  if (negativas.length > 0) {
    const g = negativas.reduce((s, p) => s + (Number(p.metricas.gasto) || 0), 0)
    tareas.push({ id: 'negativizar', prioridad: 'alta', titulo: `Excluir ${plural(negativas.length, 'término', 'términos')} que gastan sin vender`, detalle: `${dinero(g)} gastados sin un solo pedido (términos de los últimos 30 días cerrados). Los marcados «Revisar» no comparten ninguna palabra con el producto: decide tú si son otra cosa.`, ir: { filtro: 'negativizar' }, textoBoton: 'Revisar' })
  }
  if (pausas.length > 0) {
    const g = pausas.reduce((s, p) => s + (Number(p.metricas.gasto) || 0), 0)
    tareas.push({ id: 'pausar', prioridad: 'alta', titulo: `Pausar ${plural(pausas.length, 'keyword o ASIN', 'keywords o ASIN')} sin ventas`, detalle: `${dinero(g)} gastados sin un pedido, por encima del tope de excluir. Bajarles la puja solo alargaría la pérdida.`, ir: { filtro: 'pausar' }, textoBoton: 'Revisar' })
  }
  const bajar = de('bajar-puja')
  if (bajar.length > 0) tareas.push({ id: 'bajar-puja', prioridad: 'media', titulo: `Bajar ${plural(bajar.length, 'puja', 'pujas')} por encima del objetivo`, detalle: 'Venden pero con un ACoS por encima del objetivo, o han gastado un CPA entero sin vender.', ir: { filtro: 'bajar-puja' }, textoBoton: 'Revisar' })
  const promover = de('promover')
  if (promover.length > 0) {
    const sinDestino = promover.filter((p) => !p.haciaCampaignId)
    tareas.push({
      id: 'promover',
      prioridad: 'media',
      titulo: `Cosechar ${plural(promover.length, 'término', 'términos')} que ya venden`,
      detalle: `${promover.reduce((s, p) => s + (Number(p.metricas.pedidos) || 0), 0)} pedidos con ACoS dentro del objetivo: pasan a EXACTA (los ASIN, a ATAQUE ASIN) y a la vez se excluyen de la campaña de origen.${sinDestino.length ? ` ${plural(sinDestino.length, 'no tiene', 'no tienen')} campaña de destino: créala primero.` : ''}`,
      ir: { filtro: 'promover' },
      textoBoton: 'Revisar',
    })
  }
  const subir = de('subir-puja')
  if (subir.length > 0) tareas.push({ id: 'subir-puja', prioridad: 'media', titulo: `Subir ${plural(subir.length, 'puja', 'pujas')} que rinden de sobra`, detalle: 'Venden muy por debajo del ACoS objetivo: hay margen para ganar posición.', ir: { filtro: 'subir-puja' }, textoBoton: 'Revisar' })
  const presupuesto = de('presupuesto')
  if (presupuesto.length > 0) {
    const suben = presupuesto.filter((p) => (p.valorNuevo ?? 0) > (p.valorActual ?? 0)).length
    tareas.push({ id: 'presupuesto', prioridad: 'media', titulo: `Ajustar el presupuesto de ${plural(presupuesto.length, 'campaña', 'campañas')}`, detalle: `${suben ? `${plural(suben, 'se queda corta', 'se quedan cortas')} rindiendo` : ''}${suben && presupuesto.length - suben ? ' · ' : ''}${presupuesto.length - suben ? `${plural(presupuesto.length - suben, 'gasta', 'gastan')} todo perdiendo dinero` : ''}.`, ir: { filtro: 'presupuesto' }, textoBoton: 'Revisar' })
  }
  const errores = de('error')
  if (errores.length > 0) tareas.push({ id: 'error', prioridad: 'alta', titulo: `${plural(errores.length, 'cambio falló', 'cambios fallaron')} al aplicarse`, detalle: 'Amazon lo rechazó: el motivo está en cada fila. Se puede volver a intentar o descartar.', ir: { filtro: 'error' }, textoBoton: 'Ver' })

  // ---- avisos que no bloquean, pero que hay que saber al aprobar ----
  if (e.conPrecioEstimado.length > 0) {
    tareas.push({ id: 'precio-estimado', prioridad: 'info', titulo: `Precio estimado en ${plural(e.conPrecioEstimado.length, 'producto', 'productos')}`, detalle: `${e.conPrecioEstimado.slice(0, 3).map((p) => `${p.resumen} (${dinero(p.precio)})`).join(', ')}${e.conPrecioEstimado.length > 3 ? '…' : ''}: no tienen precio en su ficha y se usa el ticket medio de lo vendido por Ads. Es una estimación: si lo corriges, cambian los topes.`, ir: { pestana: 'productos' }, textoBoton: 'Revisar precios' })
  }
  if (!e.firmada && pendientes.length > 0) {
    tareas.push({ id: 'firma', prioridad: e.modo === 'sugiere' ? 'info' : 'alta', titulo: 'La ficha de cuenta no está firmada', detalle: 'Las propuestas se pueden revisar, pero no aplicar hasta que alguien firme los umbrales.', ir: { pestana: 'ficha' }, textoBoton: 'Ir a la ficha' })
  }
  if (e.faltaMigracionPausas) {
    tareas.push({ id: 'migracion-305', prioridad: 'info', titulo: 'Falta la migración 305', detalle: 'El motor ha encontrado keywords para pausar pero la base todavía no admite ese tipo de propuesta. Pide que se lance la 305.' })
  }

  if (tareas.length === 0) {
    tareas.push({ id: 'al-dia', prioridad: 'info', titulo: 'Todo al día', detalle: 'Ningún término ni segmentación cumple ahora una regla del SOP con muestra suficiente. Vuelve mañana, cuando lleguen los términos nuevos.' })
  }
  const orden = { alta: 0, media: 1, info: 2 }
  return { tareas: tareas.sort((a, b) => orden[a.prioridad] - orden[b.prioridad]), gastoSinVentaRecuperable: Math.round(recuperable * 100) / 100, pendientes: pendientes.length }
}
