/**
 * AMAZON ADS · VALIDAR LO QUE LLEGA DEL NAVEGADOR (ficha y productos).
 *
 * Funciones PURAS. Los rangos son los mismos que los CHECK de la migración 292: así un valor imposible se rechaza aquí con un mensaje que se entiende, en vez de llegar a la base y salir como
 * «violates check constraint».
 */

import { resumenNormalizado } from './estructura'
import type { CamposDeFicha, CamposDeProducto } from './cuenta'

type Resultado<T> = { ok: true; campos: T } | { ok: false; error: string }

/** Un número del cuerpo (acepta «12,5» con coma). null si está vacío; NaN si no es un número */
function numero(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN
  if (typeof v === 'string') {
    // «1.200,5» (miles con punto y decimales con coma) y «12,5» valen; «1.5» es 1,5
    const t = v.trim()
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
    return Number.isFinite(n) ? n : Number.NaN
  }
  return Number.NaN
}

function enRango(nombre: string, v: unknown, min: number, max: number, entero = false): { ok: true; valor: number } | { ok: false; error: string } {
  const n = numero(v)
  if (n == null || Number.isNaN(n)) return { ok: false, error: `«${nombre}» tiene que ser un número.` }
  if (n < min || n > max) return { ok: false, error: `«${nombre}» tiene que estar entre ${min} y ${max}.` }
  if (entero && !Number.isInteger(n)) return { ok: false, error: `«${nombre}» tiene que ser un número entero.` }
  return { ok: true, valor: n }
}

export function fichaDesdeCuerpo(c: unknown): Resultado<CamposDeFicha> {
  const b = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
  const fase = b.fase
  if (fase !== 'lanzamiento' && fase !== 'crecimiento' && fase !== 'madurez') return { ok: false, error: 'La fase tiene que ser lanzamiento, crecimiento o madurez.' }

  const defs: Array<[keyof CamposDeFicha, string, number, number, boolean]> = [
    ['acosLanzamientoX', 'ACoS objetivo en lanzamiento (× equilibrio)', 0.01, 5, false],
    ['acosMaduroX', 'ACoS objetivo maduro (× equilibrio)', 0.01, 5, false],
    ['tacosObjetivoPct', 'TACoS objetivo (%)', 0.01, 100, false],
    ['subidaPresupuestoPct', 'Subida de presupuesto (%)', 0.01, 100, false],
    ['horasEntreSubidas', 'Horas entre subidas de presupuesto', 1, 720, true],
    ['cambioPujaPct', 'Cambio de puja (%)', 0.01, 100, false],
    ['diasEntreCambiosPuja', 'Días entre cambios de puja', 1, 90, true],
    ['comprasParaExacta', 'Compras para pasar a Exacta', 1, 50, true],
    ['ventanaExactaDias', 'Ventana para pasar a Exacta (días)', 1, 90, true],
    ['gastoSinVentaX', 'Gasto sin venta (× CPA objetivo)', 0.01, 20, false],
    ['clicsMinimosNegativizar', 'Clics mínimos para negativizar', 1, 500, true],
    ['muestraMinimaClics', 'Muestra mínima de clics', 1, 500, true],
  ]
  const out: Record<string, unknown> = { fase }
  for (const [clave, nombre, min, max, entero] of defs) {
    const r = enRango(nombre, b[clave], min, max, entero)
    if (!r.ok) return r
    out[clave] = r.valor
  }
  const pres = numero(b.presupuestoMensual)
  if (Number.isNaN(pres) || (pres != null && pres < 0)) return { ok: false, error: '«Presupuesto mensual» tiene que ser un número positivo (o dejarse vacío).' }
  out.presupuestoMensual = pres
  const notas = typeof b.notas === 'string' ? b.notas.trim().slice(0, 2000) : ''
  out.notas = notas || null
  return { ok: true, campos: out as unknown as CamposDeFicha }
}

export function productoDesdeCuerpo(c: unknown): Resultado<CamposDeProducto> {
  const b = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
  const asin = typeof b.asin === 'string' ? b.asin.trim().toUpperCase() : ''
  if (!/^[A-Z0-9]{10}$/.test(asin)) return { ok: false, error: 'El ASIN tiene que tener 10 letras o números.' }
  const sku = typeof b.sku === 'string' ? b.sku.trim() : ''
  if (!sku || sku.length > 120) return { ok: false, error: 'Falta el SKU.' }
  const resumen = resumenNormalizado(typeof b.resumen === 'string' ? b.resumen : '')
  if (!resumen) return { ok: false, error: 'Falta el resumen: es la parte corta que va en el nombre de las campañas.' }
  if (resumen.length > 40) return { ok: false, error: 'El resumen es demasiado largo (máximo 40 caracteres).' }

  const precio = numero(b.precio)
  if (Number.isNaN(precio) || (precio != null && precio < 0)) return { ok: false, error: '«Precio» tiene que ser un número positivo.' }
  const coste = numero(b.costeProducto)
  if (Number.isNaN(coste) || (coste != null && coste < 0)) return { ok: false, error: '«Coste del producto» tiene que ser un número positivo.' }
  const iva = enRango('IVA (%)', b.ivaPct ?? 21, 0, 40)
  if (!iva.ok) return iva
  const comision = enRango('Comisión de Amazon (%)', b.comisionPct ?? 15, 0, 60)
  if (!comision.ok) return comision
  const fba = enRango('Tarifa FBA', b.tarifaFba ?? 0, 0, 100000)
  if (!fba.ok) return fba
  const otros = enRango('Otros costes', b.otrosCostes ?? 0, 0, 100000)
  if (!otros.ok) return otros

  const acosObjetivo = numero(b.acosObjetivoPct)
  if (Number.isNaN(acosObjetivo) || (acosObjetivo != null && (acosObjetivo <= 0 || acosObjetivo > 100))) return { ok: false, error: '«ACoS objetivo» tiene que estar entre 0 y 100 % (o dejarse vacío).' }

  const titulo = typeof b.titulo === 'string' ? b.titulo.trim().slice(0, 300) : ''
  const notas = typeof b.notas === 'string' ? b.notas.trim().slice(0, 2000) : ''
  return {
    ok: true,
    campos: {
      asin,
      sku,
      titulo: titulo || null,
      resumen,
      precio,
      ivaPct: iva.valor,
      costeProducto: coste,
      comisionPct: comision.valor,
      tarifaFba: fba.valor,
      otrosCostes: otros.valor,
      acosObjetivoPct: acosObjetivo,
      activo: b.activo !== false,
      notas: notas || null,
    },
  }
}
