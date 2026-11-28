/**
 * AMAZON ADS · EL AGENTE PPC: LA BUY BOX DE LOS PRODUCTOS ANUNCIADOS. PURO.
 *
 * Sin la oferta destacada (Buy Box) Amazon NO enseña los anuncios de Sponsored Products: no se paga el clic, pero las ventas por publicidad caen y el agente
 * lo leería como que las keywords funcionan mal (bajaría pujas, pausaría keywords buenas, quitaría presupuesto). Por eso, mientras un producto no tiene la
 * Buy Box, el agente no toca sus pujas, pausas, presupuestos ni ubicaciones, y avisa para que se arregle el precio.
 *
 *   CONGELADO  sin la Buy Box desde hace ≥ 2 h (la oferta destacada rota entre vendedores; menos que eso es ruido), o
 *              la recuperó hace < 7 días tras una pérdida de ≥ 24 h (esos días flojos siguen dentro de la ventana de 14 días con la que decide).
 *   AVISO      uno por episodio, al pasar de las 2 h.
 *   «desconocido» (Amazon no ha dicho nada útil) no cambia el estado guardado.
 */

export type EstadoDeBuyBox = 'nuestra' | 'de_otro' | 'nadie' | 'desconocido'

export const HORAS_PARA_CONGELAR = 2
export const HORAS_PERDIDA_LARGA = 24
export const DIAS_TRAS_RECUPERAR = 7
const H = 3_600_000

export interface FilaDeBuyBox {
  asin: string
  estado: EstadoDeBuyBox
  sinDesde: string | null
  recuperadaAt: string | null
  perdidaHoras: number | null
  avisadaAt: string | null
  leidaAt: string
}

/** La fila nueva tras una lectura. `previa` null = primera vez que se lee */
export function siguienteFila(previa: FilaDeBuyBox | null, asin: string, leido: EstadoDeBuyBox, ahora: number): FilaDeBuyBox {
  const iso = new Date(ahora).toISOString()
  if (leido === 'desconocido') return previa ? { ...previa, leidaAt: iso } : { asin, estado: 'desconocido', sinDesde: null, recuperadaAt: null, perdidaHoras: null, avisadaAt: null, leidaAt: iso }
  const sinAntes = previa != null && previa.sinDesde != null
  if (leido === 'nuestra') {
    if (sinAntes) {
      const horas = Math.max(0, (ahora - Date.parse(previa.sinDesde as string)) / H)
      return { asin, estado: 'nuestra', sinDesde: null, recuperadaAt: iso, perdidaHoras: Math.round(horas * 10) / 10, avisadaAt: null, leidaAt: iso }
    }
    return { asin, estado: 'nuestra', sinDesde: null, recuperadaAt: previa?.recuperadaAt ?? null, perdidaHoras: previa?.perdidaHoras ?? null, avisadaAt: null, leidaAt: iso }
  }
  // de_otro o nadie
  return {
    asin,
    estado: leido,
    sinDesde: sinAntes ? (previa.sinDesde as string) : iso,
    recuperadaAt: previa?.recuperadaAt ?? null,
    perdidaHoras: previa?.perdidaHoras ?? null,
    avisadaAt: sinAntes ? previa.avisadaAt : null,
    leidaAt: iso,
  }
}

/** ¿Está congelado ahora? Con el porqué */
export function congelado(f: FilaDeBuyBox, ahora: number): { congelado: boolean; porque: string | null } {
  if (f.sinDesde) {
    const horas = (ahora - Date.parse(f.sinDesde)) / H
    if (horas >= HORAS_PARA_CONGELAR) return { congelado: true, porque: `sin la Buy Box desde hace ${horas < 48 ? `${Math.floor(horas)} h` : `${Math.floor(horas / 24)} días`} (${f.estado === 'nadie' ? 'nadie la tiene' : 'la tiene otro vendedor'})` }
    return { congelado: false, porque: null }
  }
  if (f.recuperadaAt && (f.perdidaHoras ?? 0) >= HORAS_PERDIDA_LARGA) {
    const dias = (ahora - Date.parse(f.recuperadaAt)) / (24 * H)
    if (dias < DIAS_TRAS_RECUPERAR) return { congelado: true, porque: `recuperó la Buy Box hace ${Math.floor(dias)} días tras ${Math.round(f.perdidaHoras ?? 0)} h sin ella: sus cifras de esos días no valen para decidir` }
  }
  return { congelado: false, porque: null }
}

/** ¿Toca avisar de la pérdida? (pasa de las 2 h y no se ha avisado en este episodio) */
export function tocaAvisar(f: FilaDeBuyBox, ahora: number): boolean {
  return f.sinDesde != null && f.avisadaAt == null && (ahora - Date.parse(f.sinDesde)) / H >= HORAS_PARA_CONGELAR
}
