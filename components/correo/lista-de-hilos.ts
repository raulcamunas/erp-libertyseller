import { esRebote } from '@/lib/correo/avisos'
import { MAX_FILAS_ANIMADAS, MIN_LARGO_DE_BUSQUEDA } from '@/lib/correo/bandeja'
import type { HiloDeLista, VistaDeCorreo } from '@/lib/correo/tipos'
import type { ModoDeLista } from './contratos'

/**
 * LA LÓGICA DE LA LISTA DE HILOS, SIN REACT (ListaDeHilos.tsx y FilaDeHilo.tsx la pintan).
 * ======================================================================================
 * PURO. Se comprueba con `npx tsx components/correo/lista-de-hilos.prueba.ts`.
 *
 *   · El segmentado (Todos · Sin leer · Pendientes) y el menú «Más» (Destacados, Enviados, Recibidos) se traducen a las dos piezas de estado
 *     que ya tiene la pantalla: `vista` y `soloNoLeidos`.
 *   · Con búsqueda los filtros NO se esconden: el servidor busca en todo y aquí se aplican vista, «Sin leer» y «Ocultar silenciados» a los
 *     resultados. Sin búsqueda los aplica el servidor; aquí solo «Ocultar silenciados» (para que un hilo que se acaba de silenciar se vaya ya).
 *   · Un REBOTE nunca sale atenuado ni se oculta por estar silenciado (no se puede silenciar de verdad: avisa siempre).
 *   · Como mucho 12 filas entran animadas a la vez.
 */

export type Segmento = 'todos' | 'sin-leer' | 'pendientes'

/** Lo que va en el menú «Más», en su orden */
export const VISTAS_DE_MAS: ReadonlyArray<{ id: Exclude<VistaDeCorreo, 'todos' | 'pendientes'>; nombre: string }> = [
  { id: 'destacados', nombre: 'Destacados' },
  { id: 'enviados', nombre: 'Enviados' },
  { id: 'recibidos', nombre: 'Recibidos' },
]

/** Qué segmento sale marcado. null = la vista activa está en «Más» (el segmentado no marca ninguno y «Más» lleva su nombre) */
export function segmentoActivo(vista: VistaDeCorreo, soloNoLeidos: boolean): Segmento | null {
  if (soloNoLeidos) return 'sin-leer'
  if (vista === 'todos') return 'todos'
  if (vista === 'pendientes') return 'pendientes'
  return null
}

/** Lo que cambia al pulsar un segmento o una vista de «Más». Cada filtro es excluyente con los demás (como en el diseño) */
export function estadoDeFiltro(eleccion: Segmento | VistaDeCorreo): { vista: VistaDeCorreo; soloNoLeidos: boolean } {
  if (eleccion === 'sin-leer') return { vista: 'todos', soloNoLeidos: true }
  return { vista: eleccion, soloNoLeidos: false }
}

export const buscandoDe = (busqueda: string) => busqueda.trim().length >= MIN_LARGO_DE_BUSQUEDA

/** El hilo es un rebote («no se ha podido entregar»): lo dice su contraparte (mailer-daemon, postmaster…) o el asunto */
export function esHiloDeRebote(h: Pick<HiloDeLista, 'contraparteDireccion' | 'asunto'>): boolean {
  return esRebote({ de_direccion: h.contraparteDireccion ?? '', asunto: h.asunto ?? '' })
}

/**
 * Se ofrece «Asignar» (encargar la conversación): quien puede responder desde el buzón o un administrador, igual que la ruta
 * (hilos/[id]/encargables y el PATCH de hilos/[id] piden 'responder' a quien no es admin). La fila y la vista del hilo usan esta
 * misma regla: un supervisor de solo lectura no ve un «Asignar» que acabaría en 403.
 */
export function puedeEncargarHilo(buzon: { puedeResponder: boolean } | null | undefined, esAdmin: boolean): boolean {
  return !!buzon && (buzon.puedeResponder || esAdmin)
}

/** Sale atenuado (55 %): silenciado y no es un rebote */
export function seAtenua(h: Pick<HiloDeLista, 'silenciado' | 'contraparteDireccion' | 'asunto'>): boolean {
  return h.silenciado && !esHiloDeRebote(h)
}

export interface FiltroDeCliente {
  busqueda: string
  vista: VistaDeCorreo
  soloNoLeidos: boolean
  ocultarSilenciados: boolean
  modo: ModoDeLista
  /** El abierto nunca desaparece de la lista por un filtro (se quedaría sin fila a la que volver) */
  seleccionado: string | null
}

function pasaVista(h: HiloDeLista, vista: VistaDeCorreo): boolean {
  switch (vista) {
    case 'recibidos':
      return h.entrantes > 0
    case 'enviados':
      return h.salientes > 0
    case 'destacados':
      return h.destacado
    case 'pendientes':
      return h.esperandoRespuesta
    default:
      return true
  }
}

/**
 * Lo que se enseña de lo que ha llegado. Devuelve el MISMO array si no quita nada (para no repintar la lista).
 * «Ocultar silenciados» solo vale en «Mis correos».
 */
export function filtrarEnCliente(hilos: readonly HiloDeLista[], f: FiltroDeCliente): readonly HiloDeLista[] {
  const buscando = buscandoDe(f.busqueda)
  const ocultar = f.modo === 'mios' && f.ocultarSilenciados
  if (!buscando && !ocultar) return hilos
  const quedan = hilos.filter((h) => {
    if (h.id === f.seleccionado) return true
    if (ocultar && seAtenua(h)) return false
    if (buscando) {
      if (f.soloNoLeidos && h.noLeidos <= 0) return false
      if (!pasaVista(h, f.vista)) return false
    }
    return true
  })
  return quedan.length === hilos.length ? hilos : quedan
}

/** Las filas que entran con la animación: las nuevas, en el orden de la lista, como mucho 12 */
export function idsAnimados(hilos: readonly Pick<HiloDeLista, 'id'>[], nuevos: ReadonlySet<string>, max = MAX_FILAS_ANIMADAS): Set<string> {
  const fuera = new Set<string>()
  if (nuevos.size === 0) return fuera
  for (const h of hilos) {
    if (fuera.size >= max) break
    if (nuevos.has(h.id)) fuera.add(h.id)
  }
  return fuera
}

export type TipoDeVacio = 'sin-elegir' | 'asignados' | 'busqueda' | 'filtro' | 'vacio'

export interface Vacio {
  tipo: TipoDeVacio
  titulo: string
  descripcion: string
}

const NOMBRE_DEL_SITIO: Record<ModoDeLista, string> = { mios: 'Mis correos', asignados: 'Asignados a mí', buzon: 'este buzón' }

const TITULO_DE_FILTRO: Record<VistaDeCorreo, string> = {
  todos: 'No hay conversaciones aquí',
  pendientes: 'Nada esperando respuesta 🎉',
  destacados: 'No hay nada destacado aquí',
  enviados: 'No hay nada enviado aquí',
  recibidos: 'No hay nada recibido aquí',
}

/** Qué estado vacío toca (spec 1.5). `hayMisBuzones`: en «Mis correos» hay al menos un buzón elegido */
export function vacioDeLista(e: {
  modo: ModoDeLista
  busqueda: string
  vista: VistaDeCorreo
  soloNoLeidos: boolean
  ocultarSilenciados: boolean
  hayMisBuzones: boolean
  importando: boolean
}): Vacio {
  const sitio = NOMBRE_DEL_SITIO[e.modo]
  if (e.modo === 'mios' && !e.hayMisBuzones) {
    return { tipo: 'sin-elegir', titulo: 'Aún no has elegido tus correos', descripcion: 'Elige los buzones que trabajas: se juntan aquí, por fecha, y te avisan de lo nuevo.' }
  }
  if (buscandoDe(e.busqueda)) {
    return { tipo: 'busqueda', titulo: `Nada con «${e.busqueda.trim()}» en ${sitio}`, descripcion: 'Prueba con otra palabra o con un trozo de la dirección.' }
  }
  const conFiltro = e.soloNoLeidos || e.vista !== 'todos' || (e.modo === 'mios' && e.ocultarSilenciados)
  if (conFiltro) {
    const titulo = e.soloNoLeidos ? 'Nada sin leer aquí 🎉' : e.vista !== 'todos' ? TITULO_DE_FILTRO[e.vista] : 'Solo había conversaciones silenciadas'
    return { tipo: 'filtro', titulo, descripcion: 'Quita el filtro para ver todas las conversaciones.' }
  }
  if (e.modo === 'asignados') {
    return { tipo: 'asignados', titulo: 'No tienes conversaciones encargadas', descripcion: 'Cuando alguien te encargue una conversación, saldrá aquí hasta que la marques como hecha.' }
  }
  return {
    tipo: 'vacio',
    titulo: 'No hay conversaciones aquí',
    descripcion: e.importando ? 'Se están trayendo los correos antiguos; irán saliendo según lleguen.' : 'Cuando llegue o envíes un correo aparecerá aquí.',
  }
}

/** El título de la cabecera del móvil si no llega uno */
export function tituloDeModo(modo: ModoDeLista): string {
  return modo === 'mios' ? 'Mis correos' : modo === 'asignados' ? 'Asignados a mí' : 'Correo'
}
