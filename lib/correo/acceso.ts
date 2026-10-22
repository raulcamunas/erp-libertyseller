/**
 * QUIÉN PUEDE ABRIR QUÉ BUZÓN.
 * ============================
 * PURO: no toca la base ni la red. Se comprueba con acceso.prueba.ts. Es la regla entera, escrita una vez; las rutas
 * de /api/correo la consultan antes de tocar nada.
 *
 * Los correos son lo más sensible que guarda el ERP, así que la regla es más estrecha que la de «ver al equipo»
 * (puede_ver_equipo_comercial, migración 212) y por eso vive aquí y no en una política:
 *
 *   · EL DUEÑO abre y escribe desde su buzón. Nadie más escribe desde él: ni un administrador. Un correo enviado desde
 *     una dirección ajena es suplantar a esa persona.
 *   · UN ADMINISTRADOR puede LEER cualquier buzón y desconectar cualquiera (cuando alguien se va, o si deja una
 *     contraseña mala).
 *   · QUIEN TENGA «Supervisión del correo» (el permiso suelto 'correo-supervision', que el administrador da persona a
 *     persona) puede LEER el buzón de CUALQUIER persona del equipo y elegir cuál desde el selector. No el de un
 *     administrador: el correo de dirección no se lee por permiso.
 *   · QUIEN TENGA «Supervisión del equipo comercial» (el permiso suelto 'equipo-comercial') puede LEER los buzones de los
 *     COMERCIALES. No el de un administrador ni el de alguien que no sea del equipo comercial: supervisar ventas no es
 *     leer el correo de dirección.
 *   · UN PARTNER NO ENTRA POR SU ROL: es una figura externa a la que el middleware solo deja ver Clientes, Cuadro mensual y
 *     Reportes de 15 días. La función SQL puede_ver_equipo_comercial (migración 212) sí lo cuenta como supervisor, y por eso
 *     la regla del correo NO se apoya en ella. Solo lo que cuenta es el permiso suelto.
 *   · NADIE MÁS ve que el buzón existe: se contesta «no existe», igual que a un id inventado.
 *
 * LEER ES LO ÚNICO QUE DAN LOS PERMISOS. Escribir desde un buzón es solo de su dueño, y conectar o desconectar es del
 * dueño o de un administrador. Cada lectura de un buzón ajeno deja rastro (correo_accesos), que el dueño puede consultar.
 */

/** Un identificador de la base. Vive aquí (y no en lib/amazon/api.ts) para que los módulos de correo no arrastren Next al cargarse */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ModoDeAcceso = 'leer' | 'escribir' | 'administrar'

export interface QuienPide {
  userId: string
  role: string
  /** Tiene el permiso suelto «equipo-comercial» (Supervisión del equipo comercial) */
  tienePermisoEquipo: boolean
  /** Tiene el permiso suelto «correo-supervision» (Supervisión del correo) */
  tienePermisoCorreo: boolean
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
      /** Lo está mirando alguien que no es su dueño: hay que dejar rastro */
      porSupervision: boolean
    }
  | { ok: false; estado: 403 | 404; mensaje: string }

export const NO_EXISTE = 'No existe ese buzón.'

export function decidirAcceso(quien: QuienPide, buzon: { user_id: string }, dueno: DatosDelDueno, modo: ModoDeAcceso): DecisionDeAcceso {
  const esDueno = buzon.user_id === quien.userId
  const supervisaVentas = quien.tienePermisoEquipo && dueno.is_comercial === true
  // El permiso de correo abre a todo el equipo MENOS a los administradores. Un rol que no se conoce no es «no administrador»
  const supervisaCorreo = quien.tienePermisoCorreo && typeof dueno.role === 'string' && dueno.role !== 'admin'
  const puedeLeer = esDueno || quien.role === 'admin' || supervisaVentas || supervisaCorreo

  if (!puedeLeer) return { ok: false, estado: 404, mensaje: NO_EXISTE }

  if (modo === 'escribir' && !esDueno) {
    return { ok: false, estado: 403, mensaje: 'Solo la persona dueña del buzón puede enviar desde él.' }
  }
  if (modo === 'administrar' && !esDueno && quien.role !== 'admin') {
    return { ok: false, estado: 403, mensaje: 'Solo la persona dueña del buzón o un administrador puede cambiar su conexión.' }
  }
  return { ok: true, esDueno, porSupervision: !esDueno }
}
