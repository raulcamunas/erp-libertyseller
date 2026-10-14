/**
 * VERIFICAR LO QUE SE HA SUBIDO A AMAZON: LA CUENTA.
 * PURA: sin base de datos ni Amazon. Se comprueba con verificacion.prueba.ts.
 *
 * Media hora después de subir el stock de un cliente se vuelve a leer lo que Amazon
 * tiene de cada SKU enviado y se compara con lo que se mandó, teniendo en cuenta lo
 * que se haya vendido entretanto.
 *
 *
 * ============ CINCO RESULTADOS Y DOS TIPOS DE PROBLEMA ============
 *
 * Fallos (son los que se avisan):
 *   rechazado    Amazon no aceptó el cambio.
 *   no_aplicado  Amazon lo aceptó pero el SKU SIGUE con el valor de antes.
 *   distinto     Hay MÁS de lo que se mandó: alguien o algo ha escrito encima.
 *
 * Avisos (se cuentan pero no son un fallo):
 *   bajo_probable_venta   Hay MENOS de lo esperado. Casi siempre es una venta.
 *   no_verificable        Amazon no ha devuelto el listing o la cantidad.
 *
 * Y lo bueno: ok y ok_con_ventas.
 *
 *
 * ============ LAS VENTAS, Y POR QUÉ HAY DOS CAMINOS ============
 *
 * Con los pedidos de Amazon en la mano (`ventas` es un número) se sabe exacto qué
 * se esperaba: lo enviado menos lo vendido desde que se envió.
 *
 * SIN ellos (`ventas` es null: la aplicación no tiene el permiso de pedidos o hubo
 * demasiados) hay un caso que no se puede distinguir: si se mandaron 8 y hay 7,
 * puede ser una venta o puede ser que el cambio no se aplicara y se hayan vendido
 * tres. Se resuelve a favor de lo más probable —una venta— y se marca
 * `bajo_probable_venta` para que quede a la vista, sin llamarlo fallo. El único
 * «no aplicado» que se declara sin pedidos es el inequívoco: el SKU sigue
 * EXACTAMENTE con el valor de antes.
 */

export type Resultado =
  | 'ok'
  | 'ok_con_ventas'
  | 'bajo_probable_venta'
  | 'no_aplicado'
  | 'distinto'
  | 'rechazado'
  | 'no_verificable'

export const ES_FALLO: ReadonlySet<Resultado> = new Set<Resultado>(['rechazado', 'no_aplicado', 'distinto'])

export const TEXTO_RESULTADO: Record<Resultado, string> = {
  ok: 'Correcto',
  ok_con_ventas: 'Correcto (con ventas)',
  bajo_probable_venta: 'Ha bajado: probable venta',
  no_aplicado: 'No se aplicó',
  distinto: 'Distinto de lo enviado',
  rechazado: 'Rechazado por Amazon',
  no_verificable: 'No se ha podido verificar',
}

export interface EntradaVerificacion {
  sku: string
  /** Lo que había antes de enviar. null = no se conocía */
  anterior: number | null
  enviado: number
  /** Lo que Amazon tiene ahora. null = no ha devuelto el listing o la cantidad */
  actual: number | null
  /** Unidades vendidas desde el envío de ESTE SKU. null = no se ha podido saber */
  ventas: number | null
  /** El estado con el que quedó el envío: aceptado, confirmado, invalido, error… */
  estadoEnvio: string
  /** Por qué lo rechazó Amazon, si lo rechazó */
  errorEnvio?: string | null
}

export interface Veredicto {
  resultado: Resultado
  /** Lo que se esperaba encontrar. null si no se puede saber */
  esperado: number | null
  motivo: string
}

export function clasificarVerificacion(e: EntradaVerificacion): Veredicto {
  if (e.estadoEnvio === 'invalido' || e.estadoEnvio === 'error') {
    return { resultado: 'rechazado', esperado: null, motivo: e.errorEnvio?.trim() || 'Amazon no ha aceptado el cambio.' }
  }
  if (e.actual === null) {
    return { resultado: 'no_verificable', esperado: null, motivo: 'Amazon no ha devuelto el listing o su cantidad.' }
  }

  const noCambio = e.anterior !== null && e.actual === e.anterior

  if (e.ventas !== null) {
    const esperado = Math.max(0, e.enviado - e.ventas)
    if (e.actual === esperado) {
      return { resultado: e.ventas > 0 ? 'ok_con_ventas' : 'ok', esperado, motivo: e.ventas > 0 ? `Enviadas ${e.enviado}, vendidas ${e.ventas}, quedan ${e.actual}.` : `Hay ${e.actual}, como se envió.` }
    }
    if (noCambio && e.anterior !== esperado) {
      return { resultado: 'no_aplicado', esperado, motivo: `Sigue con ${e.actual}, que es lo que tenía antes de enviar.` }
    }
    if (e.actual < esperado) {
      return { resultado: 'bajo_probable_venta', esperado, motivo: `Se esperaban ${esperado} y hay ${e.actual}: ha bajado más de lo que explican las ventas contadas.` }
    }
    return { resultado: 'distinto', esperado, motivo: `Se esperaban ${esperado} y hay ${e.actual}.` }
  }

  // Sin datos de ventas
  if (e.actual === e.enviado) return { resultado: 'ok', esperado: e.enviado, motivo: `Hay ${e.actual}, como se envió.` }
  if (noCambio && e.anterior !== e.enviado) {
    return { resultado: 'no_aplicado', esperado: e.enviado, motivo: `Sigue con ${e.actual}, que es lo que tenía antes de enviar.` }
  }
  if (e.actual > e.enviado) {
    return { resultado: 'distinto', esperado: e.enviado, motivo: `Se enviaron ${e.enviado} y hay ${e.actual}: alguien ha escrito encima.` }
  }
  return { resultado: 'bajo_probable_venta', esperado: e.enviado, motivo: `Se enviaron ${e.enviado} y hay ${e.actual}: probablemente ventas, sin datos de pedidos para confirmarlo.` }
}

export interface FilaInforme {
  sku: string
  resultado: Resultado
  anterior: number | null
  enviado: number
  actual: number | null
  ventas: number | null
  motivo: string
}

export interface InformeVerificacion {
  total: number
  porResultado: Record<Resultado, number>
  fallos: number
  avisos: number
  /** ¿Se han podido contar las ventas del intervalo? */
  conVentas: boolean
  /** Los fallos primero, luego los avisos; con tope. El recuento siempre es el exacto */
  filas: FilaInforme[]
}

export function construirInforme(
  entradas: EntradaVerificacion[],
  opciones: { conVentas: boolean; tope?: number }
): InformeVerificacion {
  const porResultado: Record<Resultado, number> = {
    ok: 0,
    ok_con_ventas: 0,
    bajo_probable_venta: 0,
    no_aplicado: 0,
    distinto: 0,
    rechazado: 0,
    no_verificable: 0,
  }
  const filas: FilaInforme[] = []
  for (const e of entradas) {
    const v = clasificarVerificacion(e)
    porResultado[v.resultado] += 1
    if (v.resultado === 'ok' || v.resultado === 'ok_con_ventas') continue
    filas.push({ sku: e.sku, resultado: v.resultado, anterior: e.anterior, enviado: e.enviado, actual: e.actual, ventas: e.ventas, motivo: v.motivo })
  }

  const peso = (r: Resultado) => (ES_FALLO.has(r) ? 0 : 1)
  filas.sort((a, b) => peso(a.resultado) - peso(b.resultado) || a.resultado.localeCompare(b.resultado) || a.sku.localeCompare(b.sku))

  const fallos = porResultado.rechazado + porResultado.no_aplicado + porResultado.distinto
  return {
    total: entradas.length,
    porResultado,
    fallos,
    avisos: porResultado.bajo_probable_venta + porResultado.no_verificable,
    conVentas: opciones.conVentas,
    filas: filas.slice(0, opciones.tope ?? 2000),
  }
}

/** El texto del aviso a Slack. Corto a propósito: el detalle vive en el ERP */
export function textoSlack(
  i: InformeVerificacion,
  datos: { cliente: string; perfil: string; minutos: number; enlace?: string | null; maxFilas?: number }
): string {
  const buenos = i.porResultado.ok + i.porResultado.ok_con_ventas
  const cabecera =
    i.fallos === 0
      ? `:white_check_mark: *${datos.cliente}*: el stock se ha subido bien (${buenos} de ${i.total} verificados ${datos.minutos} min después).`
      : `:warning: *${datos.cliente}*: ${i.fallos} de ${i.total} SKU no han quedado bien tras subir el stock.`

  const lineas = [cabecera, `Perfil: ${datos.perfil}`]
  lineas.push(
    `Correctos: ${buenos} · Rechazados: ${i.porResultado.rechazado} · No aplicados: ${i.porResultado.no_aplicado} · ` +
      `Distintos: ${i.porResultado.distinto} · Han bajado (probable venta): ${i.porResultado.bajo_probable_venta} · ` +
      `Sin verificar: ${i.porResultado.no_verificable}`
  )
  if (!i.conVentas) {
    lineas.push('_No se han podido contar las ventas del intervalo (sin datos de pedidos): las bajadas se marcan como probables ventas._')
  }

  const fallos = i.filas.filter((f) => ES_FALLO.has(f.resultado)).slice(0, datos.maxFilas ?? 15)
  if (fallos.length > 0) {
    lineas.push('', '*Para revisar:*')
    for (const f of fallos) {
      lineas.push(
        `• \`${f.sku}\` — ${TEXTO_RESULTADO[f.resultado]}: enviado ${f.enviado}, ` +
          `${f.actual === null ? 'sin lectura' : `hay ${f.actual}`}${f.anterior !== null ? `, antes ${f.anterior}` : ''}` +
          (f.resultado === 'rechazado' ? ` (${f.motivo.slice(0, 120)})` : '')
      )
    }
    if (i.fallos > fallos.length) lineas.push(`…y ${i.fallos - fallos.length} más.`)
  }
  if (datos.enlace) lineas.push('', `Detalle completo: ${datos.enlace}`)
  return lineas.join('\n')
}
