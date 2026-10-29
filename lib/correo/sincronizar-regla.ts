/**
 * LA REGLA DE «TRAER LOS CORREOS NUEVOS DE ESTE BUZÓN, AHORA» (POST /api/correo/sincronizar).
 * =========================================================================================
 * Lo puede pedir quien LEE el buzón: su dueño, y también quien lo supervisa (un administrador, un permiso de supervisión o un buzón abierto a mano) siempre que no se
 * lo hayan bloqueado (la ruta lo comprueba con la regla de acceso de lib/correo/acceso.ts, en modo «leer»). Es seguro por lo mismo que lo es el proceso automático: solo LEE
 * del servidor de correo (no envía, no borra, no marca nada allí), y la contraseña se usa en el servidor, nunca sale. Lo único que cambia es CUÁNDO: antes un supervisor solo veía
 * lo que el proceso automático traía cada pocos minutos y no podía pedir más; ahora puede pedirlo, con el mismo tope de frecuencia que el dueño.
 *
 * Una lectura reciente no vuelve a preguntar al servidor de correo: no hay nada nuevo en 15 segundos, los proveedores limitan las conexiones, y con varias personas mirando el
 * mismo buzón (más el dueño y el proceso automático) este tope es lo que impide que se pisen. Una importación a medias (primer histórico) no cuenta: sigue avanzando.
 *
 * Es puro y se comprueba con sincronizar-regla.prueba.ts. Lo usa la ruta; la pantalla no necesita importar nada de aquí.
 */

/** Dentro de este tiempo desde el último intento no se vuelve a preguntar al servidor de correo */
export const ENTRE_LECTURAS_MS = 15_000

/** ¿Se ha intentado leer este buzón hace tan poco que no merece volver a hacerlo? Solo con el histórico completo: una importación a medias sigue */
export function leidoHaceNada(buzon: { historico_completo: boolean; ultimo_intento_at: string | null }, ahora: number): boolean {
  if (!buzon.historico_completo || !buzon.ultimo_intento_at) return false
  const ultimo = Date.parse(buzon.ultimo_intento_at)
  return Number.isFinite(ultimo) && ahora - ultimo < ENTRE_LECTURAS_MS
}

/** Lo que se le dice a quien pidió la lectura cuando el servidor de correo rechaza la contraseña: solo el dueño puede volver a escribirla */
export function fraseDeContrasenaRechazada(esDueno: boolean): string {
  return esDueno
    ? 'El servidor de correo ha rechazado la contraseña. Vuelve a escribirla para seguir recibiendo correos.'
    : 'El servidor de correo ha rechazado la contraseña de este buzón. Su dueño tiene que volver a escribirla (en los ajustes de su buzón) para que lleguen correos nuevos.'
}

/** Lo que se le dice cuando el buzón está desconectado (sin contraseña guardada): solo el dueño puede conectarlo */
export function fraseDeBuzonDesconectado(esDueno: boolean): string {
  return esDueno ? 'Este buzón está desconectado. Vuelve a conectarlo.' : 'Este buzón está desconectado: su dueño tiene que volver a conectarlo para que lleguen correos nuevos.'
}
