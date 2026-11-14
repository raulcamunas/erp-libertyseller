import { analizarProductos, resumenDeRitmo, serieDeRemesa } from './analisis'
import { panelDeCliente } from './datos'
import { esEnvio, esPropuesta, estaEnlazada } from './vista'
import type { ColumnaTablero, TarjetaTablero } from './tablero'

/**
 * LOS ENVÍOS DE UN CLIENTE, EN LA FORMA DEL TABLERO. SOLO SERVIDOR.
 *
 * Reutiliza `panelDeCliente` —el mismo cálculo que la pantalla de un cliente, para que las cifras de la tarjeta coincidan con las del detalle— y se queda con lo que pinta una tarjeta.
 * Es lo más caro de leer del módulo (remesas, líneas, ventas por día), y el tablero lo pide de todos los clientes: por eso el resultado de cada uno se guarda 3 minutos en la memoria del
 * servidor y se tira al importar un envío. Y por eso no se lee de todos a la vez (la base es pequeña): de dos en dos.
 */

const VIDA_MS = 3 * 60_000
const cache = new Map<string, { en: number; datos: Omit<ColumnaTablero, 'nombre' | 'puedeEditar'> }>()

export function olvidarTablero(clienteId: string): void {
  cache.delete(clienteId)
}

async function leer(clienteId: string, hoy: string): Promise<Omit<ColumnaTablero, 'nombre' | 'puedeEditar'>> {
  const guardado = cache.get(clienteId)
  if (guardado && Date.now() - guardado.en < VIDA_MS) return guardado.datos
  const panel = await panelDeCliente(clienteId, { hoy })
  const globales = new Map(panel.skus.map((s) => [s.sku, s]))
  const tarjetas: TarjetaTablero[] = panel.remesas
    .filter((r) => esEnvio(r) && estaEnlazada(r))
    .map((r) => {
      const vendidas = r.lineas.reduce((s, l) => s + l.consumidas, 0)
      return {
        id: r.id,
        nombre: r.nombre,
        fechaEnvio: r.fechaEnvio,
        referenciaEnvio: r.referenciaEnvio ?? '',
        estadoAmazon: r.estadoAmazon,
        seguimientoError: r.seguimientoError,
        quedan: r.quedan,
        enviadas: r.enviadas,
        vendidas,
        noLlegaron: r.unidadesQueNoLlegaron,
        referencias: r.lineas.length,
        cobertura: r.quedan === 0 ? null : resumenDeRitmo(r, analizarProductos(r, globales, hoy), hoy).cobertura,
        chispa: serieDeRemesa(r, hoy).slice(-14).map((d) => Math.max(0, d.vendidas)),
      }
    })
  const datos = { clienteId, tarjetas, propuestas: panel.remesas.filter(esPropuesta).length }
  cache.set(clienteId, { en: Date.now(), datos })
  return datos
}

export async function columnasDelTablero(clientes: ReadonlyArray<{ id: string; nombre: string; puedeEditar: boolean }>, hoy: string, paralelo = 2): Promise<ColumnaTablero[]> {
  const salida: ColumnaTablero[] = new Array(clientes.length)
  let siguiente = 0
  async function trabajador() {
    while (siguiente < clientes.length) {
      const i = siguiente++
      const c = clientes[i]
      try {
        salida[i] = { ...(await leer(c.id, hoy)), nombre: c.nombre, puedeEditar: c.puedeEditar }
      } catch (e) {
        console.error(`Tablero de remesas: no se ha podido leer ${c.nombre}:`, e instanceof Error ? e.message : e)
        salida[i] = { clienteId: c.id, nombre: c.nombre, puedeEditar: c.puedeEditar, tarjetas: [], propuestas: 0 }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, clientes.length) }, trabajador))
  return salida
}
