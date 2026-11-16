/**
 * QUIÉN PUEDE ABRIR QUÉ BUZÓN, Y QUÉ PUEDE HACER CON ÉL.
 * ======================================================
 * PURO: no toca la base ni la red. Se comprueba con acceso.prueba.ts. Es la regla entera, escrita una vez; las rutas
 * de /api/correo la consultan antes de tocar nada.
 *
 * Los correos son lo más sensible que guarda el ERP, así que la regla es más estrecha que la de «ver al equipo»
 * (puede_ver_equipo_comercial, migración 212) y por eso vive aquí y no en una política.
 *
 * CUATRO MODOS, de menos a más:
 *   · 'leer'        ver la lista, un hilo, buscar, abrir un adjunto, sincronizar y silenciar para uno mismo.
 *   · 'responder'   enviar, responder, reenviar, redactar con IA, marcar leído o no leído, destacar y asignar un hilo.
 *   · 'escribir'    CONFIGURAR el buzón (nombre, firma, contraseña) y programar secuencias. También lo usan el análisis de
 *                   Keepa y el informe de Cuentas para ENVIAR desde el buzón propio: por eso su mensaje es neutro.
 *   · 'administrar' desconectar y ver el rastro.
 *
 * QUIÉN LEE:
 *   · EL DUEÑO, el suyo. Siempre: ni un bloqueo colado se lo quita.
 *   · UN ADMINISTRADOR, cualquiera (cuando alguien se va, o si deja una contraseña mala). A un administrador no se le
 *     bloquea nada: es quien decide.
 *   · QUIEN TENGA «Supervisión del correo» (el permiso suelto 'correo-supervision', que el administrador da persona a
 *     persona): el de CUALQUIER persona del equipo, menos el de un administrador. El correo de dirección no se lee por
 *     permiso, y un dueño cuyo rol no se conoce tampoco (ante la duda, no se abre).
 *   · QUIEN TENGA «Supervisión del equipo comercial» (el permiso suelto 'equipo-comercial'): los de los COMERCIALES.
 *     Supervisar ventas no es leer el correo de dirección.
 *   · QUIEN TENGA UN BUZÓN CONCEDIDO (Correo → «Quién ve qué», migración 255): ESE buzón, ni uno más. Concede cualquier
 *     buzón de un employee o de un administrador: lo decide quien lo concede.
 *   · QUIEN TENGA UN BUZÓN ASIGNADO (un administrador se lo asigna para que lo trabaje, migración 318): ese buzón. La
 *     asignación da lectura, avisos y «Mis correos» aunque no tenga ningún permiso.
 *   · UN BUZÓN BLOQUEADO (migración 260) NO lo lee esa persona por ninguna vía: ni permiso, ni concesión, ni asignación.
 *     Es lo que permite dar un permiso de supervisión y, aun así, dejar fuera los buzones que no deba leer. Asignación y
 *     bloqueo no conviven (el servidor quita uno al poner el otro); si convivieran por una fila colada, gana el bloqueo.
 *   · UN PARTNER NO ENTRA POR SU ROL: es una figura externa a la que el middleware solo deja ver Clientes, Cuadro mensual
 *     y Reportes de 15 días. La función SQL puede_ver_equipo_comercial (migración 212) sí lo cuenta como supervisor, y por
 *     eso la regla del correo NO se apoya en ella: solo cuenta el permiso suelto. Tampoco entra por un buzón concedido ni
 *     por una asignación, aunque estuviera en la tabla.
 *   · NADIE MÁS ve que el buzón existe: se contesta «no existe», igual que a un id inventado.
 *
 * QUIÉN ESCRIBE DESDE UN BUZÓN: su dueño y, desde uno ajeno, SOLO quien tenga una asignación explícita de un
 * administrador con «Puede responder y enviar». Tampoco un administrador escribe desde un buzón ajeno por serlo: tiene
 * que asignárselo a sí mismo, y eso queda en el historial. Un correo enviado desde una dirección ajena es hablar en nombre
 * de esa persona, así que cada envío de quien no es el dueño deja su rastro ANTES de salir (si no se puede anotar, el
 * correo no sale) y el mensaje guarda quién lo envió.
 *
 * Configurar el buzón y las secuencias sigue siendo solo del dueño; desconectar, del dueño o de un administrador.
 * Cada lectura de un buzón ajeno, también la de quien lo tiene asignado, deja rastro (correo_accesos). El rastro solo lo
 * ve un administrador.
 */

/** Un identificador de la base. Vive aquí (y no en lib/amazon/api.ts) para que los módulos de correo no arrastren Next al cargarse */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ModoDeAcceso = 'leer' | 'responder' | 'escribir' | 'administrar'

export interface QuienPide {
  userId: string
  role: string
  /** Tiene el permiso suelto «equipo-comercial» (Supervisión del equipo comercial) */
  tienePermisoEquipo: boolean
  /** Tiene el permiso suelto «correo-supervision» (Supervisión del correo) */
  tienePermisoCorreo: boolean
  /** Los buzones (ids) que un administrador le ha abierto uno a uno para LEER (tabla correo_buzon_lectores). Sin esto, ninguno */
  buzonesConcedidos?: ReadonlySet<string>
  /** Los buzones (ids) que un administrador le ha BLOQUEADO (tabla correo_buzon_bloqueos, migración 260): no los lee por ningún permiso. Sin esto, ninguno */
  buzonesBloqueados?: ReadonlySet<string>
  /** Buzones que un administrador le ha ASIGNADO (tabla correo_buzon_asignaciones, migración 318). Asignado = lee, aunque no tenga permiso. Sin esto, ninguno */
  buzonesAsignados?: ReadonlySet<string>
  /** De esos, en los que además puede RESPONDER y enviar (puede_responder = true). Un id que no esté también en buzonesAsignados no cuenta */
  buzonesConRespuesta?: ReadonlySet<string>
}

/** Lo que hay que saber del dueño de un buzón para decidir quién lo puede leer */
export interface DatosDelDueno {
  is_comercial: boolean | null
  /** Su rol en el ERP. null = no se ha podido saber, y ante la duda no se abre */
  role: string | null
}

export type DecisionDeAcceso =
  | {
      ok: true
      esDueno: boolean
      /** Lo está mirando alguien que no es su dueño: hay que dejar rastro (también si lo tiene asignado) */
      porSupervision: boolean
      /** Un administrador se lo ha asignado a quien pide */
      asignado: boolean
      /** Puede enviar, responder y marcar desde él: el dueño, o quien lo tiene asignado con respuesta */
      puedeResponder: boolean
    }
  | { ok: false; estado: 403 | 404; mensaje: string }

export const NO_EXISTE = 'No existe ese buzón.'
export const SOLO_ASIGNADO_RESPONDE = 'Para escribir desde este buzón te lo tiene que asignar un administrador.'
export const SOLO_EL_DUENO = 'Solo la persona dueña del buzón puede hacer esto.'
export const SOLO_DUENO_O_ADMIN = 'Solo la persona dueña del buzón o un administrador puede cambiar su conexión.'

export function decidirAcceso(quien: QuienPide, buzon: { user_id: string; id?: string }, dueno: DatosDelDueno, modo: ModoDeAcceso): DecisionDeAcceso {
  const esDueno = buzon.user_id === quien.userId
  const esPartner = quien.role === 'partner'
  const supervisaVentas = quien.tienePermisoEquipo && dueno.is_comercial === true
  // El permiso de correo abre a todo el equipo MENOS a los administradores. Un rol que no se conoce no es «no administrador»
  const supervisaCorreo = quien.tienePermisoCorreo && typeof dueno.role === 'string' && dueno.role !== 'admin'
  // Un buzón abierto a mano por un administrador: ese y solo ese. Hace falta el id del buzón; sin él, ninguno. Un partner no entra por aquí aunque estuviera en la tabla
  const concedido = !esPartner && buzon.id !== undefined && quien.buzonesConcedidos?.has(buzon.id) === true
  // Un buzón asignado por un administrador (318): se lee y, si la asignación lo dice, se responde. Mismas cautelas: con id, y nunca un partner
  const asignado = !esPartner && buzon.id !== undefined && quien.buzonesAsignados?.has(buzon.id) === true
  const conRespuesta = asignado && buzon.id !== undefined && quien.buzonesConRespuesta?.has(buzon.id) === true
  // Un buzón bloqueado a esta persona no se lee por ninguna vía. El dueño y el administrador no se bloquean nunca. Hace falta el id del buzón; sin él no se puede saber
  const bloqueado = !esDueno && quien.role !== 'admin' && buzon.id !== undefined && quien.buzonesBloqueados?.has(buzon.id) === true
  const puedeLeer = !bloqueado && (esDueno || quien.role === 'admin' || supervisaVentas || supervisaCorreo || concedido || asignado)

  if (!puedeLeer) return { ok: false, estado: 404, mensaje: NO_EXISTE }

  const puedeResponder = esDueno || (conRespuesta && !bloqueado)

  if (modo === 'responder' && !puedeResponder) {
    return { ok: false, estado: 403, mensaje: SOLO_ASIGNADO_RESPONDE }
  }
  if (modo === 'escribir' && !esDueno) {
    return { ok: false, estado: 403, mensaje: SOLO_EL_DUENO }
  }
  if (modo === 'administrar' && !esDueno && quien.role !== 'admin') {
    return { ok: false, estado: 403, mensaje: SOLO_DUENO_O_ADMIN }
  }
  return { ok: true, esDueno, porSupervision: !esDueno, asignado, puedeResponder }
}

/**
 * De unos buzones ajenos (asignados o seguidos), los que quien pide puede LEER de verdad. Pasan todos por la regla, también
 * los asignados: si una asignación y un bloqueo llegan a convivir (dos administradores a la vez, o una fila colada), gana el
 * bloqueo, como en la bandeja, el hilo y la campana. Un dueño que no sale en el mapa es un dueño desconocido: no se abre.
 */
export function buzonesAjenosQueSeLeen<B extends { id: string; user_id: string }>(
  quien: QuienPide,
  buzones: readonly B[],
  duenos: ReadonlyMap<string, Partial<DatosDelDueno>>
): B[] {
  return buzones.filter((b) => {
    const d = duenos.get(b.user_id)
    return decidirAcceso(quien, b, { is_comercial: d?.is_comercial ?? null, role: d?.role ?? null }, 'leer').ok
  })
}
