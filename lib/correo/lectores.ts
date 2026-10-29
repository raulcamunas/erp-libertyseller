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
 * Y desde la migración 260, UNA CUARTA COSA QUE SE PUEDE HACER: BLOQUEAR. Un administrador le bloquea a una persona un buzón concreto y esa persona deja de leerlo aunque un
 * permiso de supervisión (o un buzón abierto a mano) se lo abriera. Así se puede dar «Supervisión del correo» o «del equipo comercial» a quien lo necesite para su trabajo y,
 * aun así, dejarle fuera los buzones que no debe leer (por ejemplo los de los administrativos). El bloqueo no cambia el permiso: solo cierra ese buzón. `via` sigue diciendo
 * por dónde lo vería SIN el bloqueo (para saber qué pasa el día que se lo quiten) y `bloqueado` dice si hoy lo tiene cerrado.
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
  dueno: {
    id: string
    nombre: string
    role: string | null
    esComercial: boolean | null
    /** El puesto del dueño (migración 257): comercial, manager_comercial o gestion_administrativa. null o ausente = sin puesto */
    puesto?: string | null
  }
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

/** Un buzón que un administrador le ha bloqueado a una persona (tabla correo_buzon_bloqueos, migración 260) */
export interface Bloqueo {
  buzonId: string
  lectorId: string
  /** Quién se lo bloqueó (nombre) */
  por: string | null
  /** Cuándo (ISO) */
  desde: string
}

export interface CeldaDeAcceso {
  /** El motivo por el que lo vería, el más fuerte, SIN contar el bloqueo: suyo, un permiso de supervisión, abierto a mano, o ninguno */
  via: ViaDeAcceso
  /** Hay además (o solo) un buzón abierto a mano para esa persona. Si hoy lo ve por un permiso, este es el que seguirá abierto el día que se lo quiten */
  concedido: boolean
  /** Un administrador le ha bloqueado este buzón: hoy NO lo lee, sea cual sea `via` */
  bloqueado: boolean
}

export interface FilaDeLaMatriz {
  persona: PersonaDeLaMatriz
  /** Por id de buzón */
  celdas: Record<string, CeldaDeAcceso>
  /** Cuántos buzones ajenos lee esta persona hoy, de cualquier forma (los bloqueados no cuentan) */
  leidos: number
  /** Cuántos buzones tiene bloqueados */
  bloqueados: number
}

export interface Matriz {
  buzones: BuzonDeLaMatriz[]
  filas: FilaDeLaMatriz[]
}

export function celdaDe(persona: PersonaDeLaMatriz, buzon: BuzonDeLaMatriz, concedido: boolean, bloqueado = false): CeldaDeAcceso {
  // El suyo no se bloquea: el dueño siempre lee el suyo
  if (buzon.dueno.id === persona.id) return { via: 'suyo', concedido: false, bloqueado: false }
  // ¿Lo abre ya un permiso de supervisión? Se pregunta a la regla de verdad, SIN contar lo abierto a mano, para no repetirla aquí
  const quien: QuienPide = { userId: persona.id, role: persona.role, tienePermisoEquipo: persona.permisoEquipo, tienePermisoCorreo: persona.permisoCorreo }
  const porPermiso = decidirAcceso(quien, { user_id: buzon.dueno.id, id: buzon.id }, { is_comercial: buzon.dueno.esComercial, role: buzon.dueno.role }, 'leer').ok
  if (porPermiso) return { via: 'permiso', concedido, bloqueado }
  return { via: concedido ? 'concedido' : 'nada', concedido, bloqueado }
}

/**
 * La matriz. Las filas son las personas que importan para decidir: los employees con la aplicación «Correo», y quien ya tenga algún buzón abierto o un permiso de
 * supervisión aunque haya perdido la casilla (para poder ver y quitar lo que le queda). Un administrador no sale (lee todo y no hay nada que decidir) ni un partner o un cliente
 * (no entran al correo del ERP). Por nombre.
 */
export function armarMatriz(entrada: { personas: readonly PersonaDeLaMatriz[]; buzones: readonly BuzonDeLaMatriz[]; concesiones: readonly Concesion[]; bloqueos?: readonly Bloqueo[] }): Matriz {
  const abiertos = new Set(entrada.concesiones.map((c) => `${c.lectorId}|${c.buzonId}`))
  const cerrados = new Set((entrada.bloqueos ?? []).map((b) => `${b.lectorId}|${b.buzonId}`))
  // Quien tiene algo abierto o bloqueado sale aunque haya perdido la casilla de Correo: para poder ver y quitar lo que le queda
  const conAlgo = new Set([...entrada.concesiones.map((c) => c.lectorId), ...(entrada.bloqueos ?? []).map((b) => b.lectorId)])
  const buzones = [...entrada.buzones].sort((a, b) => a.dueno.nombre.localeCompare(b.dueno.nombre, 'es') || a.direccion.localeCompare(b.direccion, 'es'))

  const filas = entrada.personas
    .filter((p) => p.role === 'employee' && (p.tieneCorreo || conAlgo.has(p.id) || p.permisoEquipo || p.permisoCorreo))
    .map<FilaDeLaMatriz>((persona) => {
      const celdas: Record<string, CeldaDeAcceso> = {}
      let leidos = 0
      let bloqueados = 0
      for (const b of buzones) {
        const c = celdaDe(persona, b, abiertos.has(`${persona.id}|${b.id}`), cerrados.has(`${persona.id}|${b.id}`))
        celdas[b.id] = c
        if (c.bloqueado) bloqueados += 1
        else if (c.via === 'permiso' || c.via === 'concedido') leidos += 1
      }
      return { persona, celdas, leidos, bloqueados }
    })
    .sort((a, b) => a.persona.nombre.localeCompare(b.persona.nombre, 'es'))

  return { buzones, filas }
}

/** Un cambio ya hecho, para la lista de «últimos cambios» de la pantalla */
export interface CambioReciente {
  accion: 'concedido' | 'quitado' | 'bloqueado' | 'desbloqueado'
  buzon: string
  lector: string
  porQuien: string
  cuando: string
}

/** Lo que contesta la ruta /api/correo/lectores y pinta la pantalla */
export interface DatosDeLaMatriz {
  matriz: Matriz
  concesiones: Concesion[]
  /** Los buzones bloqueados a alguien. Vacío si la migración 260 no está lanzada (ver `bloqueosDisponibles`) */
  bloqueos: Bloqueo[]
  /** ¿Se puede bloquear? false = falta lanzar la migración 260: la pantalla lo dice y no ofrece bloquear */
  bloqueosDisponibles: boolean
  /** Los últimos cambios, del más nuevo al más viejo */
  recientes: CambioReciente[]
}

/* ------------------------------------------------------------------ */
/* Los cambios                                                         */
/* ------------------------------------------------------------------ */

/**
 * Un cambio sobre UN buzón de UNA persona: abrirlo o cerrarlo a mano (`leer`), o bloquearlo o desbloquearlo (`bloquear`, migración 260). Uno de los dos, nunca los dos.
 */
export type CambioDeLector =
  | {
      buzonId: string
      /** true = abrir ese buzón a esa persona; false = cerrarlo */
      leer: boolean
      bloquear?: undefined
    }
  | {
      buzonId: string
      /** true = bloquearle ese buzón (no lo lee por ningún permiso); false = quitarle el bloqueo */
      bloquear: boolean
      leer?: undefined
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
    const { buzonId, leer, bloquear } = (c ?? {}) as { buzonId?: unknown; leer?: unknown; bloquear?: unknown }
    if (typeof buzonId !== 'string' || !UUID.test(buzonId)) return { ok: false, error: 'Uno de los buzones no es válido.' }
    if (leer !== undefined && bloquear !== undefined) return { ok: false, error: 'Un cambio no puede abrir y bloquear el mismo buzón a la vez.' }
    if (typeof leer !== 'boolean' && typeof bloquear !== 'boolean') return { ok: false, error: 'Falta decir si el buzón se abre, se cierra, se bloquea o se desbloquea.' }
    const id = buzonId.toLowerCase()
    if (vistos.has(id)) return { ok: false, error: 'Un mismo buzón sale dos veces en la petición.' }
    vistos.add(id)
    salida.push(typeof bloquear === 'boolean' ? { buzonId: id, bloquear } : { buzonId: id, leer: leer as boolean })
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
 * Qué cambios se pueden hacer. A QUIÉN se le abre o se le bloquea tiene que ser un employee (un administrador ya lo lee todo y no se le bloquea nada; un partner o un cliente no
 * entran al correo) y no el dueño del buzón (ya lo lee, y el suyo no se bloquea). Un buzón que no existe se rechaza. Cerrar un buzón que no estaba abierto, o quitar un bloqueo que
 * no estaba, no es un error: no cambia nada.
 */
export function decidirCambios(
  lector: { id: string; role: string } | null,
  buzones: ReadonlyMap<string, { dueno: string }>,
  peticion: PeticionDeCambio
): { ok: false; estado: number; error: string } | ({ ok: true } & DecisionDeCambios) {
  if (!lector) return { ok: false, estado: 404, error: 'No existe esa persona.' }
  if (lector.role !== 'employee') {
    return { ok: false, estado: 422, error: lector.role === 'admin' ? 'Un administrador lee todos los buzones: no se le abre ni se le bloquea ninguno.' : 'Solo se abren o se bloquean buzones a personas del equipo (no a partners ni a clientes).' }
  }
  const aplicar: CambioDeLector[] = []
  const rechazados: DecisionDeCambios['rechazados'] = []
  for (const c of peticion.cambios) {
    const b = buzones.get(c.buzonId)
    if (!b) rechazados.push({ buzonId: c.buzonId, motivo: 'Ese buzón no existe.' })
    else if (b.dueno === lector.id) rechazados.push({ buzonId: c.buzonId, motivo: c.bloquear !== undefined ? 'Es su propio buzón: no se le puede bloquear.' : 'Es su propio buzón: ya lo lee.' })
    else aplicar.push(c)
  }
  return { ok: true, aplicar, rechazados }
}

/* ------------------------------------------------------------------ */
/* Los grupos de buzones, para bloquear o desbloquear de golpe         */
/* ------------------------------------------------------------------ */

export type GrupoDeBuzones = 'administrativos' | 'comerciales'

/** El puesto de quien lleva la administración (lib/usuarios/puestos.ts: «Gestión Administrativa») */
export const PUESTO_ADMINISTRATIVO = 'gestion_administrativa'

/**
 * «Los administrativos»: los buzones de quien tiene el puesto «Gestión Administrativa». NO «cualquiera que no sea comercial»: un manager tampoco está marcado como comercial
 * (en producción, Jhanna) y no es un administrativo; el atajo «Bloquear administrativos» le habría quitado su buzón a quien supervisa. Sin puesto, no se sabe: no se cuenta.
 */
export const esDeAdministrativo = (b: BuzonDeLaMatriz): boolean => b.dueno.role !== 'admin' && b.dueno.puesto === PUESTO_ADMINISTRATIVO

export const esDeComercial = (b: BuzonDeLaMatriz): boolean => b.dueno.esComercial === true

const delGrupo = (b: BuzonDeLaMatriz, grupo: GrupoDeBuzones): boolean => (grupo === 'administrativos' ? esDeAdministrativo(b) : esDeComercial(b))

/**
 * Los buzones de un grupo que se le pueden BLOQUEAR a esta persona desde su fila: no el suyo, solo los que hoy lee de verdad (por un permiso o abiertos a mano: bloquear uno que
 * no lee no cambia nada) y que aún no tiene bloqueados.
 */
export function paraBloquear(fila: FilaDeLaMatriz, buzones: readonly BuzonDeLaMatriz[], grupo: GrupoDeBuzones): BuzonDeLaMatriz[] {
  return buzones.filter((b) => {
    const c = fila.celdas[b.id]
    return !!c && delGrupo(b, grupo) && c.via !== 'suyo' && !c.bloqueado && (c.via === 'permiso' || c.via === 'concedido')
  })
}

/** Los que tiene bloqueados esta persona (de un grupo, o todos si no se dice cuál) y se le pueden desbloquear */
export function paraDesbloquear(fila: FilaDeLaMatriz, buzones: readonly BuzonDeLaMatriz[], grupo?: GrupoDeBuzones): BuzonDeLaMatriz[] {
  return buzones.filter((b) => fila.celdas[b.id]?.bloqueado === true && (grupo === undefined || delGrupo(b, grupo)))
}
