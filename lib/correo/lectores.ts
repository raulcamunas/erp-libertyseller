import { UUID, decidirAcceso, type QuienPide } from './acceso'

/**
 * QUIÉN VE QUÉ BUZÓN: LA MATRIZ QUE ADMINISTRA UN MANAGER, Y LOS CAMBIOS QUE SE LE PUEDEN HACER.
 * =============================================================================================
 * PURO: no toca la base ni la red. Se comprueba con lectores.prueba.ts. Lo lee y lo escribe el servidor (lectores-servidor.ts) y lo pinta
 * components/correo/PermisosDeBuzones.tsx.
 *
 * Un administrador lee todos los buzones. Para el resto, desde la migración 255, hay una tercera forma de leer un buzón además de ser su dueño o de tener uno de los
 * dos permisos sueltos de supervisión (acceso.ts): que un administrador se lo haya ABIERTO A MANO, a esa persona y a ese buzón. Esta matriz junta las tres cosas para
 * que quien decide vea de un vistazo QUIÉN LEE QUÉ DE VERDAD, y toque solo lo que se puede tocar aquí (lo abierto a mano):
 *
 *   · suyo        es su propio buzón.
 *   · permiso     ya lo abre un permiso de supervisión que esa persona tiene (se quita en Gestión de Usuarios, no aquí: abre más de lo que se ve en esta pantalla).
 *   · concedido   se lo ha abierto un administrador a mano.
 *   · nada        no lo ve.
 *
 * Es solo LECTURA y cada vez que alguien mira un buzón que no es suyo queda anotado: abrirlo no da permiso para escribir desde él, ni para desconectarlo.
 */

export interface PersonaDeLaMatriz {
  id: string
  nombre: string
  email: string | null
  role: string
  /** Tiene la casilla de la aplicación «Correo»: sin ella no puede abrir la pantalla, así que un buzón abierto no le serviría */
  tieneCorreo: boolean
  /** Tiene el permiso suelto «Supervisión del equipo comercial» */
  permisoEquipo: boolean
  /** Tiene el permiso suelto «Supervisión del correo» */
  permisoCorreo: boolean
}

export interface BuzonDeLaMatriz {
  id: string
  direccion: string
  nombre: string | null
  dueno: { id: string; nombre: string; role: string | null; esComercial: boolean | null }
}

export interface Concesion {
  buzonId: string
  lectorId: string
  /** Quién se lo abrió (nombre) */
  por: string | null
  /** Cuándo (ISO) */
  desde: string
}

export type ViaDeAcceso = 'suyo' | 'permiso' | 'concedido' | 'nada'

export interface CeldaDeAcceso {
  /** El motivo por el que lo ve, el más fuerte: suyo, un permiso de supervisión, abierto a mano, o ninguno */
  via: ViaDeAcceso
  /** Hay además (o solo) un buzón abierto a mano para esa persona. Si hoy lo ve por un permiso, este es el que seguirá abierto el día que se lo quiten */
  concedido: boolean
}

export interface FilaDeLaMatriz {
  persona: PersonaDeLaMatriz
  /** Por id de buzón */
  celdas: Record<string, CeldaDeAcceso>
  /** Cuántos buzones ajenos lee esta persona, de cualquier forma */
  leidos: number
}

export interface Matriz {
  buzones: BuzonDeLaMatriz[]
  filas: FilaDeLaMatriz[]
}

export function celdaDe(persona: PersonaDeLaMatriz, buzon: BuzonDeLaMatriz, concedido: boolean): CeldaDeAcceso {
  if (buzon.dueno.id === persona.id) return { via: 'suyo', concedido: false }
  // ¿Lo abre ya un permiso de supervisión? Se pregunta a la regla de verdad, SIN contar lo abierto a mano, para no repetirla aquí
  const quien: QuienPide = { userId: persona.id, role: persona.role, tienePermisoEquipo: persona.permisoEquipo, tienePermisoCorreo: persona.permisoCorreo }
  const porPermiso = decidirAcceso(quien, { user_id: buzon.dueno.id, id: buzon.id }, { is_comercial: buzon.dueno.esComercial, role: buzon.dueno.role }, 'leer').ok
  if (porPermiso) return { via: 'permiso', concedido }
  return { via: concedido ? 'concedido' : 'nada', concedido }
}

/**
 * La matriz. Las filas son las personas que importan para decidir: los employees con la aplicación «Correo», y quien ya tenga algún buzón abierto o un permiso de
 * supervisión aunque haya perdido la casilla (para poder ver y quitar lo que le queda). Un administrador no sale (lee todo y no hay nada que decidir) ni un partner o un cliente
 * (no entran al correo del ERP). Por nombre.
 */
export function armarMatriz(entrada: { personas: readonly PersonaDeLaMatriz[]; buzones: readonly BuzonDeLaMatriz[]; concesiones: readonly Concesion[] }): Matriz {
  const abiertos = new Set(entrada.concesiones.map((c) => `${c.lectorId}|${c.buzonId}`))
  const conAlgo = new Set(entrada.concesiones.map((c) => c.lectorId))
  const buzones = [...entrada.buzones].sort((a, b) => a.dueno.nombre.localeCompare(b.dueno.nombre, 'es') || a.direccion.localeCompare(b.direccion, 'es'))

  const filas = entrada.personas
    .filter((p) => p.role === 'employee' && (p.tieneCorreo || conAlgo.has(p.id) || p.permisoEquipo || p.permisoCorreo))
    .map<FilaDeLaMatriz>((persona) => {
      const celdas: Record<string, CeldaDeAcceso> = {}
      let leidos = 0
      for (const b of buzones) {
        const c = celdaDe(persona, b, abiertos.has(`${persona.id}|${b.id}`))
        celdas[b.id] = c
        if (c.via === 'permiso' || c.via === 'concedido') leidos += 1
      }
      return { persona, celdas, leidos }
    })
    .sort((a, b) => a.persona.nombre.localeCompare(b.persona.nombre, 'es'))

  return { buzones, filas }
}

/** Un cambio ya hecho, para la lista de «últimos cambios» de la pantalla */
export interface CambioReciente {
  accion: 'concedido' | 'quitado'
  buzon: string
  lector: string
  porQuien: string
  cuando: string
}

/** Lo que contesta la ruta /api/correo/lectores y pinta la pantalla */
export interface DatosDeLaMatriz {
  matriz: Matriz
  concesiones: Concesion[]
  /** Los últimos cambios, del más nuevo al más viejo */
  recientes: CambioReciente[]
}

/* ------------------------------------------------------------------ */
/* Los cambios                                                         */
/* ------------------------------------------------------------------ */

export interface CambioDeLector {
  buzonId: string
  /** true = abrir ese buzón a esa persona; false = cerrarlo */
  leer: boolean
}

export interface PeticionDeCambio {
  lectorId: string
  cambios: CambioDeLector[]
}

export const MAX_CAMBIOS_POR_PETICION = 50

/** El cuerpo de la petición, validado. Los ids tienen que ser identificadores de verdad y cada buzón sale una sola vez */
export function validarPeticion(entrada: unknown): { ok: true; peticion: PeticionDeCambio } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'El cuerpo no es válido.' }
  const { lectorId, cambios } = entrada as { lectorId?: unknown; cambios?: unknown }
  if (typeof lectorId !== 'string' || !UUID.test(lectorId)) return { ok: false, error: 'Falta la persona a la que se le abre o cierra el buzón.' }
  if (!Array.isArray(cambios) || cambios.length === 0) return { ok: false, error: 'No hay ningún cambio que hacer.' }
  if (cambios.length > MAX_CAMBIOS_POR_PETICION) return { ok: false, error: `Demasiados cambios de golpe (máximo ${MAX_CAMBIOS_POR_PETICION}).` }
  const vistos = new Set<string>()
  const salida: CambioDeLector[] = []
  for (const c of cambios) {
    const { buzonId, leer } = (c ?? {}) as { buzonId?: unknown; leer?: unknown }
    if (typeof buzonId !== 'string' || !UUID.test(buzonId)) return { ok: false, error: 'Uno de los buzones no es válido.' }
    if (typeof leer !== 'boolean') return { ok: false, error: 'Falta decir si el buzón se abre o se cierra.' }
    const id = buzonId.toLowerCase()
    if (vistos.has(id)) return { ok: false, error: 'Un mismo buzón sale dos veces en la petición.' }
    vistos.add(id)
    salida.push({ buzonId: id, leer })
  }
  return { ok: true, peticion: { lectorId: lectorId.toLowerCase(), cambios: salida } }
}

export interface DecisionDeCambios {
  /** Lo que se hace de verdad */
  aplicar: CambioDeLector[]
  /** Lo que no se puede hacer, con el motivo (se cuenta a quien lo pidió) */
  rechazados: Array<{ buzonId: string; motivo: string }>
}

/**
 * Qué cambios se pueden hacer. A QUIÉN se le abre tiene que ser un employee (un administrador ya lo lee todo; un partner o un cliente no entran al correo) y no el
 * dueño del buzón (ya lo lee). Un buzón que no existe se rechaza. Cerrar un buzón que no estaba abierto no es un error: no cambia nada.
 */
export function decidirCambios(
  lector: { id: string; role: string } | null,
  buzones: ReadonlyMap<string, { dueno: string }>,
  peticion: PeticionDeCambio
): { ok: false; estado: number; error: string } | ({ ok: true } & DecisionDeCambios) {
  if (!lector) return { ok: false, estado: 404, error: 'No existe esa persona.' }
  if (lector.role !== 'employee') {
    return { ok: false, estado: 422, error: lector.role === 'admin' ? 'Un administrador ya lee todos los buzones: no hace falta abrirle ninguno.' : 'Solo se abren buzones a personas del equipo (no a partners ni a clientes).' }
  }
  const aplicar: CambioDeLector[] = []
  const rechazados: DecisionDeCambios['rechazados'] = []
  for (const c of peticion.cambios) {
    const b = buzones.get(c.buzonId)
    if (!b) rechazados.push({ buzonId: c.buzonId, motivo: 'Ese buzón no existe.' })
    else if (b.dueno === lector.id) rechazados.push({ buzonId: c.buzonId, motivo: 'Es su propio buzón: ya lo lee.' })
    else aplicar.push(c)
  }
  return { ok: true, aplicar, rechazados }
}
