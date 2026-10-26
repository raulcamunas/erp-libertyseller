import { NextResponse } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { MODELOS_ELEGIBLES, precioDe } from '@/lib/ia/precios'
import { FALLO_GENERICO, registrar } from '@/lib/correo/rutas'
import { FALTA_MIGRACION_250, esFaltaDeLaMigracion250, type VersionDeWhatsapp } from './ia-laboratorio-servidor'
import type { ModeloVista, VersionDeWhatsappVista } from './ia-laboratorio-tipos'

/**
 * LO QUE COMPARTEN LAS RUTAS DE /api/correo/laboratorio/whatsapp — SOLO SERVIDOR.
 *
 * Aquí se cambia lo que la IA le escribe a los clientes de TODO el equipo, así que la puerta es la misma que la de la configuración de correos: el permiso «Configuración de la IA»
 * (`requerirConfigCorreos`, lib/correo/laboratorio-rutas.ts; un administrador entra siempre). Ninguna ruta reenvía el texto de una excepción: lo que sale a la pantalla son frases
 * fijas (puede traer parte de un lead).
 */

/** El fallo de una ruta, como respuesta: 503 con el nombre del fichero si falta la migración 250, 500 si no */
export function respuestaDeFalloDeWhatsapp(contexto: string, error: unknown): NextResponse {
  registrar(contexto, error)
  if (esFaltaDeLaMigracion250(error)) return fail(503, FALTA_MIGRACION_250)
  return fail(500, FALLO_GENERICO)
}

/** Lo que enseña la pantalla de una versión: sin quién la creó ni la publicó */
export function vistaDeVersion(v: VersionDeWhatsapp): VersionDeWhatsappVista {
  return {
    id: v.id,
    nombre: v.nombre,
    notas: v.notas,
    perfil: v.perfil,
    enProduccion: v.enProduccion,
    esBase: v.esBase,
    archivada: v.archivada,
    publicadaAt: v.publicadaAt,
    bloqueada: v.bloqueada,
    creadaAt: v.creadaAt,
    actualizadaAt: v.actualizadaAt,
  }
}

/** Los modelos que se pueden elegir, con lo que cobra OpenAI por cada uno (la pantalla calcula con ello cuánto costaría un mensaje) */
export function vistaDeLosModelos(): ModeloVista[] {
  return MODELOS_ELEGIBLES.map((m) => {
    const p = precioDe(m.id)
    return { ...m, precio: { entrada: p?.entrada ?? 0, cache: p?.cache ?? null, salida: p?.salida ?? 0 } }
  })
}
