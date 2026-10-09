import { leerTodo } from '@/lib/prestashop/cliente'
import { claveDe } from '@/lib/prestashop/conexion'
import { unirStock, type FilaPS } from '@/lib/prestashop/stock'

/**
 * LEER LA TIENDA PARA UNA AUDITORÍA.
 * SOLO SERVIDOR. Solo lee.
 *
 * NUNCA LANZA. Es lo más importante de este fichero: se llama a la vez que la
 * lectura de Amazon, y si una tienda lenta o caída pudiera tumbar la auditoría,
 * el auditor dejaría de funcionar por culpa de algo que no es Amazon. Cualquier
 * fallo vuelve como `estado: 'error'` con su motivo, y la auditoría sigue.
 *
 *
 * ============ QUÉ SE LEE CADA VEZ Y QUÉ NO ============
 *
 * El stock (`stock_availables`) cambia a cada rato y se lee en CADA pasada. Las
 * combinaciones y los productos —qué EAN y qué referencia tiene cada talla— casi
 * no cambian, y son dos tercios de lo que habría que descargar. Se guardan una
 * hora en memoria del proceso.
 *
 * Con una pasada cada diez minutos son 144 lecturas al día de la tienda de un
 * cliente, que tiene un hosting compartido: lo que no hace falta pedir no se pide.
 */

type Fila = Record<string, unknown>

const TTL_ESTRUCTURA_MS = 60 * 60 * 1000
const estructura = new Map<string, { at: number; combos: Fila[]; productos: Fila[] }>()

export type LecturaTienda =
  | { estado: 'omitida' }
  | { estado: 'ok'; tallas: FilaPS[]; duplicadosStock: number; ms: number }
  | { estado: 'error'; error: string; ms: number }

/** Que una tienda que no contesta no se lleve por delante el tiempo de la auditoría */
function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`La tienda no ha terminado de contestar en ${Math.round(ms / 1000)} segundos.`)),
      ms
    )
    promesa.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

export async function leerTienda(clientId: string, limiteMs: number): Promise<LecturaTienda> {
  const inicio = Date.now()
  try {
    const conexion = await claveDe(clientId)
    if (!conexion) return { estado: 'omitida' }

    const leida = await conLimite(
      (async () => {
        const stock = await leerTodo(conexion, 'stock_availables', [
          'id_product',
          'id_product_attribute',
          'quantity',
        ])

        let est = estructura.get(clientId)
        if (!est || Date.now() - est.at > TTL_ESTRUCTURA_MS) {
          try {
            const combos = await leerTodo(conexion, 'combinations', ['id', 'id_product', 'ean13', 'reference'])
            const productos = await leerTodo(conexion, 'products', ['id', 'ean13', 'reference'])
            est = { at: Date.now(), combos, productos }
            estructura.set(clientId, est)
          } catch (e) {
            // Con la estructura de hace más de una hora sigue valiendo para cruzar:
            // un EAN no cambia de talla. Sin ninguna, no hay con qué cruzar.
            if (!est) throw e
          }
        }
        return unirStock(stock, est.combos, est.productos)
      })(),
      limiteMs
    )

    return { estado: 'ok', tallas: leida.filas, duplicadosStock: leida.duplicadosStock, ms: Date.now() - inicio }
  } catch (e) {
    return {
      estado: 'error',
      // El motivo, sin nada que pueda llevar la clave: los errores de cliente.ts
      // no la incluyen nunca.
      error: (e instanceof Error ? e.message : 'No se ha podido leer la tienda.').slice(0, 500),
      ms: Date.now() - inicio,
    }
  }
}
