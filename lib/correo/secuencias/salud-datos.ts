import type { AlmacenDeSecuencias } from './almacen'
import type { AjustesDelMotor } from './reglas'
import { MINUTOS_DE_RETRASO_EN_LA_COLA, type BuzonParaLaSalud, type EntradaDeSalud, type VentanaDeRebotes } from './salud'

/**
 * LO QUE SE MIDE PARA LA SALUD — SOLO SERVIDOR.
 * =============================================
 * Reúne, con las consultas del almacén, lo que `salud.ts` necesita para juzgar cómo van los buzones y el motor: cómo va la conexión de cada buzón,
 * sus rebotes en 24 horas y en 7 días, las pasadas del motor y la cola. Lo usan DOS sitios con los mismos números: la pantalla (servidor.ts) y el
 * vigía que avisa por la campana (vigia.ts).
 *
 * Lo del motor (pasadas, cola) solo se mide si `conMotor`: es de todo el sistema y solo lo ve quien administra.
 */

type Almacen = AlmacenDeSecuencias

const DIA_MS = 86_400_000

const porBuzon = (filas: ReadonlyArray<{ buzonId: string; enviados: number; rebotes: number }>, ids: ReadonlySet<string>): Map<string, VentanaDeRebotes> =>
  new Map(filas.filter((f) => ids.has(f.buzonId)).map((f) => [f.buzonId, { enviados: f.enviados, rebotes: f.rebotes }]))

export async function medirLaSalud(
  almacen: Almacen,
  e: { ahora: number; ajustes: AjustesDelMotor; buzones: readonly BuzonParaLaSalud[]; conMotor: boolean }
): Promise<EntradaDeSalud> {
  const ids = e.buzones.map((b) => b.id)
  const conjunto = new Set(ids)
  const [conexion, h24, h7d, pasadas, atrasados, fallidos, ia, ultimoEnvioAt, verificacion] = await Promise.all([
    almacen.conexionDeBuzones(ids),
    ids.length > 0 ? almacen.saludDeBuzones(e.ahora - DIA_MS) : Promise.resolve([]),
    ids.length > 0 ? almacen.saludDeBuzones(e.ahora - 7 * DIA_MS) : Promise.resolve([]),
    e.conMotor ? almacen.pasadasDelMotor(e.ahora) : Promise.resolve(null),
    e.conMotor ? almacen.pasosAtrasados(e.ahora, MINUTOS_DE_RETRASO_EN_LA_COLA * 60_000, 200).then((l) => l.length) : Promise.resolve(0),
    e.conMotor ? almacen.enviosFallidos() : Promise.resolve(0),
    // Las respuestas que la IA no ha podido leer: las de la última semana (una de hace un mes ya no es noticia)
    e.conMotor ? almacen.contarRespuestas(null, e.ahora - 7 * DIA_MS) : Promise.resolve({ porClase: {}, pendientes: 0, fallidas: 0 }),
    e.conMotor ? almacen.ultimoEnvioDelSistema(e.ahora) : Promise.resolve(null),
    // La verificación de direcciones: vigilarla nunca tumba la salud (sin la migración 256 o con un fallo de lectura, no hay nada que decir de ella)
    e.conMotor ? almacen.estadoDeLaVerificacion().catch(() => null) : Promise.resolve(null),
  ])
  return {
    ahora: e.ahora,
    ajustes: e.ajustes,
    buzones: e.buzones,
    conexion,
    rebotes24h: porBuzon(h24, conjunto),
    rebotes7d: porBuzon(h7d, conjunto),
    pasadas,
    cola: { atrasados, fallidos, iaFallidas: ia.fallidas, iaPendientes: ia.pendientes, ultimoEnvioAt },
    conMotor: e.conMotor,
    verificacion,
  }
}
