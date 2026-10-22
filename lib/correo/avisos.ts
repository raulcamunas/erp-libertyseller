/**
 * QUÉ CORREOS NUEVOS MERECEN UN AVISO EN PANTALLA.
 * ================================================
 * PURO: no toca la base ni la red. Se comprueba con avisos.prueba.ts.
 *
 * Mientras se trabaja en otra aplicación del ERP, el correo se sigue leyendo por detrás (POST /api/correo/avisos) y lo que llega sale como
 * un aviso abajo a la derecha. No todo lo que llega merece interrumpir:
 *
 *   · Lo que escribe una PERSONA (una respuesta de un cliente, un correo nuevo): sí. Es justo lo que hay que contestar pronto.
 *   · Un REBOTE («no se pudo entregar»): sí, con otro tono. Dice que un correo nuestro no llegó, y eso el comercial quiere saberlo ya.
 *   · Lo AUTOMÁTICO (boletines, notificaciones de Amazon, respuestas de «estoy fuera de la oficina», facturas): no. Se ve en la bandeja como
 *     cualquier otro y el contador de sin leer sigue contándolo, pero avisar de cada uno acabaría haciendo que se ignoraran todos los avisos.
 *
 * LO QUE LLEGA ES NUEVO DE VERDAD: ni un correo antiguo traído al conectar el buzón por primera vez (entra de golpe, con la fecha de hace
 * meses), ni uno ya leído. Eso lo cierra la consulta (fecha reciente y sin leer); esto solo decide cuáles de los que quedan se enseñan.
 */

export interface MensajeParaAviso {
  id: string
  buzon_id: string
  hilo_id: string
  de_nombre: string | null
  de_direccion: string
  asunto: string
  vista_previa: string
  fecha: string
  automatico: boolean
}

export interface AvisoDeCorreo {
  id: string
  buzonId: string
  hiloId: string
  /** Quién lo envía: su nombre, o su dirección si no trae nombre */
  de: string
  asunto: string
  vistaPrevia: string
  fecha: string
  /** Es un aviso de que un correo nuestro no se pudo entregar */
  rebote: boolean
}

/** Un remitente de los que devuelven los correos que no pueden entregar */
const REMITENTE_DE_REBOTE = /^(?:mailer-daemon|postmaster|mail\.?delivery(?:\.?subsystem)?)(?:[._+-]|\d|$)/i
const ASUNTO_DE_REBOTE = /^\s*(?:undeliver|delivery status|returned mail|mail delivery (?:failed|system)|failure notice|delivery failure|no se (?:ha )?(?:pudo|podido) entregar|mensaje no entregado|error de entrega|devuelto)/i

export function esRebote(m: Pick<MensajeParaAviso, 'de_direccion' | 'asunto'>): boolean {
  const local = m.de_direccion.split('@')[0] ?? ''
  return REMITENTE_DE_REBOTE.test(local) || ASUNTO_DE_REBOTE.test(m.asunto)
}

const recortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t)

/** De la lista de correos nuevos a los avisos que se enseñan: personas y rebotes, del más reciente al más antiguo y sin pasar de `max` */
export function avisosDeCorreo(filas: readonly MensajeParaAviso[], max = 5): AvisoDeCorreo[] {
  return filas
    .map((m) => ({ m, rebote: esRebote(m) }))
    .filter(({ m, rebote }) => rebote || !m.automatico)
    .sort((a, b) => Date.parse(b.m.fecha) - Date.parse(a.m.fecha))
    .slice(0, Math.max(0, max))
    .map(({ m, rebote }) => ({
      id: m.id,
      buzonId: m.buzon_id,
      hiloId: m.hilo_id,
      de: m.de_nombre?.trim() || m.de_direccion,
      asunto: recortar(m.asunto.trim() || '(sin asunto)', 140),
      vistaPrevia: recortar(m.vista_previa.replace(/\s+/g, ' ').trim(), 160),
      fecha: m.fecha,
      rebote,
    }))
}

/** Cuánto se mira hacia atrás el «es nuevo»: lo que tenga una fecha más antigua se importó de golpe y no es un correo que acabe de llegar */
export const VENTANA_DE_NOVEDAD_MS = 3 * 60 * 60_000
/** Margen que se resta al «desde» de la última consulta: el reloj de la base y el del servidor no van a la par. Los repetidos los descarta el navegador por su id */
export const MARGEN_DE_RELOJ_MS = 30_000
