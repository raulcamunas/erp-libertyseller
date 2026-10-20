import type { CajaEntrante } from './cajas'

/**
 * LIMPIAR Y COMPROBAR LAS CAJAS QUE LLEGAN DE FUERA, ANTES DE TOCAR LA BASE.
 * =========================================================================
 * PURA: no toca la base ni la red. Se comprueba con cajas-validacion.prueba.ts.
 *
 * Sale de la ruta PUT /api/fba/remesas/[id]/cajas, donde vivía metida entre el control de acceso y
 * la escritura. La necesitan DOS puertas distintas —la del ERP, con sesión, y la página pública del
 * encaje, con un enlace— y no pueden decidir cada una por su lado qué es una caja válida: una
 * diferencia de criterio entre las dos sería justo el tipo de fallo que no se ve hasta que Amazon
 * rechaza un envío.
 *
 * ============ SE VALIDA TODO ANTES DE TOCAR NADA ============
 *
 * guardarCajas() borra el conjunto entero para reescribirlo, así que un fallo a mitad dejaría a la
 * remesa sin cajas. Aquí se mira todo primero y se devuelve la PRIMERA razón por la que no vale,
 * escrita para que la lea quien tecleó el dato.
 */

export const MAX_CAJAS = 500

/** Un tope que no molesta a nadie y frena el dedo gordo: 1.000 cm de lado o 1.000 kg no es una caja, es un tecleo */
export const MAX_MEDIDA = 1000

export type ResultadoDeLimpieza = { ok: true; cajas: CajaEntrante[] } | { ok: false; error: string }

export interface OpcionesDeLimpieza {
  maxCajas?: number
  /**
   * Lo declarado en la remesa, por SKU. Si se pasa, la limpieza es ESTRICTA: solo se aceptan SKU de
   * esta remesa y nunca más unidades de las declaradas. Es lo que se le exige a la página pública,
   * donde quien escribe no es de la agencia; la ruta del ERP no lo pide porque el cuadre ya marca
   * lo que sobra y la agencia puede querer verlo para corregirlo.
   */
  declaradas?: ReadonlyMap<string, number>
}

export function limpiarCajas(crudas: unknown, opciones: OpcionesDeLimpieza = {}): ResultadoDeLimpieza {
  const maxCajas = opciones.maxCajas ?? MAX_CAJAS
  if (!Array.isArray(crudas)) return { ok: false, error: 'Falta la lista de cajas' }
  if (crudas.length > maxCajas) return { ok: false, error: `Son demasiadas cajas (máximo ${maxCajas})` }

  const numeros = new Set<number>()
  const limpias: CajaEntrante[] = []
  const encajadas = new Map<string, number>()

  for (const [i, cruda] of (crudas as Array<Record<string, unknown> | null>).entries()) {
    const c = cruda ?? {}
    const numero = Number(c.numero)
    if (!Number.isInteger(numero) || numero <= 0) return { ok: false, error: `La caja ${i + 1} no tiene un número válido` }
    if (numeros.has(numero)) return { ok: false, error: `Hay dos cajas con el número ${numero}` }
    numeros.add(numero)

    const medidas: Partial<Record<'largoCm' | 'anchoCm' | 'altoCm' | 'pesoKg', number | null>> = {}
    for (const [campo, nombre] of [
      ['largoCm', 'largo'],
      ['anchoCm', 'ancho'],
      ['altoCm', 'alto'],
      ['pesoKg', 'peso'],
    ] as const) {
      const v = c[campo]
      if (v === null || v === undefined || v === '') {
        medidas[campo] = null
        continue
      }
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `La caja ${numero}: «${nombre}» tiene que ser un número mayor que cero` }
      if (n > MAX_MEDIDA) return { ok: false, error: `La caja ${numero}: «${nombre}» es imposible` }
      medidas[campo] = n
    }

    const vistos = new Set<string>()
    const contenido: Array<{ sku: string; unidades: number }> = []
    for (const x of (Array.isArray(c.contenido) ? c.contenido : []) as Array<Record<string, unknown> | null>) {
      const sku = typeof x?.sku === 'string' ? x.sku.trim() : ''
      if (!sku) continue
      const unidades = Number(x?.unidades)
      if (!Number.isInteger(unidades) || unidades < 0) return { ok: false, error: `La caja ${numero}: las unidades de ${sku} no son válidas` }
      if (unidades === 0) continue
      if (vistos.has(sku)) return { ok: false, error: `La caja ${numero} tiene ${sku} dos veces. Súmalo en una sola línea` }
      vistos.add(sku)
      if (opciones.declaradas && !opciones.declaradas.has(sku)) return { ok: false, error: `La caja ${numero}: ${sku} no es de este envío` }
      encajadas.set(sku, (encajadas.get(sku) ?? 0) + unidades)
      contenido.push({ sku, unidades })
    }

    limpias.push({
      numero,
      largoCm: medidas.largoCm ?? null,
      anchoCm: medidas.anchoCm ?? null,
      altoCm: medidas.altoCm ?? null,
      pesoKg: medidas.pesoKg ?? null,
      contenido,
    })
  }

  if (opciones.declaradas) {
    for (const [sku, n] of encajadas) {
      const declaradas = opciones.declaradas.get(sku) ?? 0
      if (n > declaradas) return { ok: false, error: `${sku}: hay ${n} unidades en las cajas y en el envío son ${declaradas}` }
    }
  }

  return { ok: true, cajas: limpias }
}
