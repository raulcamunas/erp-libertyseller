/**
 * AMAZON ADS · EL AGENTE PPC: AVISOS AL CANAL Y LÍNEA DE TIEMPO. SOLO SERVIDOR.
 *
 *   avisar        publica en #notificaciones-erp con la clave `ads-agente:<perfil>:<hecho>:<fecha>[:<id>]` (la misma clave no se escribe dos veces).
 *                 Por defecto llega también a la campana solo lo urgente (freno, stock, errores, ventas hundidas, la campaña que más vende sin
 *                 presupuesto, la primera escritura real): lo demás (resumen, fin del ensayo, techo automático…) solo va al canal.
 *   anotarEvento  una fila en `ads_agente_eventos` (la línea de tiempo de la pestaña «Agente»).
 *
 * Las dos NUNCA LANZAN: que no se pueda avisar o apuntar no puede tumbar lo que el agente acaba de hacer en Amazon. Sin la migración 315,
 * anotarEvento no hace nada (en silencio).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { publicarEnElChat } from '@/lib/chat/sistema-servidor'
import { claveDeAviso, type HechoDeAviso } from './avisos-calculo'
import type { TipoDeEvento } from './tipos'

/** Los hechos que además llegan a la campana y al móvil (tabla de avisos de la especificación, §7) */
const HECHOS_A_LA_CAMPANA: ReadonlySet<HechoDeAviso> = new Set<HechoDeAviso>(['freno', 'stock', 'stock-fallo', 'agotada-top', 'errores', 'ventas-caidas', 'primera-escritura', 'deshacer-fallo'])

/** Los avisos del agente PPC en #notificaciones-erp. Apagados el 20 nov 2026 por Raúl */
const AVISOS_DEL_AGENTE_EN_EL_CHAT = false

const TITULO_MAX = 300
const DETALLE_MAX = 4000

const recortar = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Publica un aviso del agente en #notificaciones-erp. `fecha` es la de Madrid (la de la clave). Nunca lanza */
export async function avisar(
  perfilId: string,
  hecho: HechoDeAviso,
  fecha: string,
  texto: { titulo: string; cuerpo: string },
  opciones?: { id?: string; avisar?: boolean },
): Promise<void> {
  // APAGADO (Raúl, 20 nov 2026: «que no salgan notificaciones ahí»). Lo que pasa sigue en la línea de tiempo del agente (anotarEvento).
  if (!AVISOS_DEL_AGENTE_EN_EL_CHAT) return
  try {
    await publicarEnElChat({
      clave: claveDeAviso(perfilId, hecho, fecha, opciones?.id),
      titulo: texto.titulo,
      cuerpo: texto.cuerpo,
      avisar: opciones?.avisar ?? HECHOS_A_LA_CAMPANA.has(hecho),
    })
  } catch (e) {
    console.error(`Agente PPC: no se ha podido avisar «${hecho}» de la cuenta ${perfilId}:`, e instanceof Error ? e.message : e)
  }
}

/** Apunta un evento en la línea de tiempo del agente. Nunca lanza; sin la 315 no hace nada */
export async function anotarEvento(
  perfilId: string,
  tipo: TipoDeEvento,
  titulo: string,
  detalle?: string | null,
  datos?: unknown,
  propuestaId?: string | null,
): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from('ads_agente_eventos')
      .insert({
        perfil_id: perfilId,
        tipo,
        titulo: recortar(titulo || tipo, TITULO_MAX),
        detalle: detalle ? recortar(detalle, DETALLE_MAX) : null,
        datos: datos === undefined ? null : datos,
        propuesta_id: propuestaId ?? null,
      })
    if (error && !isMissingSchema(error)) console.error(`Agente PPC: no se ha podido apuntar el evento «${tipo}» de la cuenta ${perfilId}:`, error.message)
  } catch (e) {
    console.error(`Agente PPC: no se ha podido apuntar el evento «${tipo}» de la cuenta ${perfilId}:`, e instanceof Error ? e.message : e)
  }
}

/** Los tipos de las guardas técnicas que añade la migración 330 al CHECK de `ads_agente_eventos` */
const TIPOS_DE_LA_330: ReadonlySet<TipoDeEvento> = new Set<TipoDeEvento>(['datos_viejos', 'vigilar_falla', 'sin_autorizacion'])

/**
 * Apunta un evento de una guarda técnica (datos viejos, vigilar que falla, sin autorización) UNA vez desde `desdeIso` (el inicio del día): la guarda se
 * mira en cada pasada y sin esto llenaría la línea de tiempo. Sin la migración 330 el CHECK no admite el tipo: se apunta como «uso_error» con el tipo
 * real en `datos.guarda` (mismo tono ámbar de «no puedo leer algo»), para que se vea igual. Nunca lanza.
 */
export async function anotarGuardaUnaVez(perfilId: string, tipo: TipoDeEvento, desdeIso: string, titulo: string, detalle?: string | null, datos?: Record<string, unknown>): Promise<void> {
  try {
    const service = createServiceClient()
    const contar = async (t: TipoDeEvento, conGuarda: boolean) => {
      let q = service.from('ads_agente_eventos').select('id', { count: 'exact', head: true }).eq('perfil_id', perfilId).eq('tipo', t).gte('creado_at', desdeIso)
      if (conGuarda) q = q.eq('datos->>guarda', tipo)
      const { count, error } = await q
      return error ? 0 : (count ?? 0)
    }
    if ((await contar(tipo, false)) > 0) return
    if (TIPOS_DE_LA_330.has(tipo) && (await contar('uso_error', true)) > 0) return
    const fila = { perfil_id: perfilId, tipo, titulo: recortar(titulo || tipo, TITULO_MAX), detalle: detalle ? recortar(detalle, DETALLE_MAX) : null, datos: { ...(datos ?? {}), guarda: tipo } }
    const { error } = await service.from('ads_agente_eventos').insert(fila)
    if (!error || isMissingSchema(error)) return
    // 23514 = el CHECK aún no tiene el tipo (falta la 330)
    if (error.code === '23514' && TIPOS_DE_LA_330.has(tipo)) {
      const { error: e2 } = await service.from('ads_agente_eventos').insert({ ...fila, tipo: 'uso_error' })
      if (!e2 || isMissingSchema(e2)) return
      console.error(`Agente PPC: no se ha podido apuntar la guarda «${tipo}» de la cuenta ${perfilId}:`, e2.message)
      return
    }
    console.error(`Agente PPC: no se ha podido apuntar la guarda «${tipo}» de la cuenta ${perfilId}:`, error.message)
  } catch (e) {
    console.error(`Agente PPC: no se ha podido apuntar la guarda «${tipo}» de la cuenta ${perfilId}:`, e instanceof Error ? e.message : e)
  }
}
