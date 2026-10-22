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
 *   · QUIEN TENGA «Supervisión del equipo comercial» (el permiso suelto 'equipo-comercial') puede LEER los buzones de los
 *     COMERCIALES. No el de un administrador ni el de alguien que no sea del equipo comercial: supervisar ventas no es
 *     leer el correo de dirección.
 *   · UN PARTNER NO ENTRA: es una figura externa a la que el middleware solo deja ver Clientes, Cuadro mensual y Reportes
 *     de 15 días. La función SQL puede_ver_equipo_comercial (migración 212) sí lo cuenta como supervisor, y por eso la regla
 *     del correo NO se apoya en ella.
 *   · NADIE MÁS ve que el buzón existe: se contesta «no existe», igual que a un id inventado.
 *
 * Cada lectura de un buzón ajeno deja rastro (correo_accesos), que el dueño puede consultar.
 */

/** Un identificador de la base. Vive aquí (y no en lib/amazon/api.ts) para que los módulos de correo no arrastren Next al cargarse */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ModoDeAcceso = 'leer' | 'escribir' | 'administrar'

export interface QuienPide {
  userId: string
  role: string
  /** Tiene el permiso suelto «equipo-comercial» (Supervisión del equipo comercial) */
  tienePermisoEquipo: boolean
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

export function decidirAcceso(
  quien: QuienPide,
  buzon: { user_id: string },
  dueno: { is_comercial: boolean | null },
  modo: ModoDeAcceso
): DecisionDeAcceso {
  const esDueno = buzon.user_id === quien.userId
  const supervisaVentas = quien.tienePermisoEquipo
  const puedeLeer = esDueno || quien.role === 'admin' || (supervisaVentas && dueno.is_comercial === true)

  if (!puedeLeer) return { ok: false, estado: 404, mensaje: NO_EXISTE }

  if (modo === 'escribir' && !esDueno) {
    return { ok: false, estado: 403, mensaje: 'Solo la persona dueña del buzón puede enviar desde él.' }
  }
  if (modo === 'administrar' && !esDueno && quien.role !== 'admin') {
    return { ok: false, estado: 403, mensaje: 'Solo la persona dueña del buzón o un administrador puede cambiar su conexión.' }
  }
  return { ok: true, esDueno, porSupervision: !esDueno }
}
