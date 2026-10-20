import { puedeAvanzar, type Cuadre, type EstadoDeCajas, type EstadoRemesa } from './flujo'

/**
 * EL RESUMEN DE UN ENCAJE: QUÉ FALTA PARA PODER DECIR «HE TERMINADO».
 * =================================================================
 * PURO: sin base de datos ni red. Se comprueba con encaje-resumen.prueba.ts.
 *
 * Lo usan DOS sitios a la vez y por eso vive aquí: la página pública donde el cliente reparte las
 * unidades en cajas —que lo recalcula a cada toque— y el servidor, que lo vuelve a mirar antes de
 * dejar terminar. Lo que decide si se puede terminar NO se reescribe: es `puedeAvanzar` de
 * lib/fba/flujo.ts, la misma función que usa el ERP, así que el cliente ve los mismos avisos que
 * vería la agencia y no puede haber una página que deje pasar lo que el ERP rechazaría.
 */

export interface LineaParaEncajar {
  sku: string
  nombre: string | null
  variante: string | null
  referencia: string | null
  /** Las unidades que se declararon al montar el envío: las que tienen que acabar en alguna caja */
  unidades: number
}

export interface CajaEnEdicion {
  numero: number
  largoCm: number | null
  anchoCm: number | null
  altoCm: number | null
  pesoKg: number | null
  contenido: Array<{ sku: string; unidades: number }>
}

/** Desde cuántos kilos una caja es «carga pesada» para Amazon: se etiqueta aparte. Es un aviso, no un error */
export const KG_DE_CARGA_PESADA = 15

export interface PorSku {
  declaradas: number
  encajadas: number
  /** Declaradas menos encajadas: lo que falta por meter en alguna caja. Negativo si hay de más */
  restantes: number
}

export interface ResumenDeEncaje {
  declaradas: number
  encajadas: number
  /** Lo que todavía no está en ninguna caja */
  pendientes: number
  /** Lo que está en las cajas y no hay declarado: mercancía de más */
  sobrantes: number
  porSku: Record<string, PorSku>
  cajas: number
  /** Los números de las cajas a las que les falta alguna medida o el peso */
  sinMedidas: number[]
  /** Los números de las cajas sin nada dentro */
  vacias: number[]
  /** Los números de las cajas que pasan de KG_DE_CARGA_PESADA */
  pesadas: number[]
  pesoTotalKg: number
  /** Lo que lee `puedeAvanzar`, en el mismo formato que en el ERP */
  cuadre: Cuadre
  estadoDeCajas: EstadoDeCajas
  /** ¿Se puede pulsar «He terminado de encajar»? */
  listo: boolean
  /** Lo que falta para poder, en frases que se enseñan tal cual. Vacío si se puede */
  motivos: string[]
}

/** ¿Tiene las tres medidas y el peso, todos mayores que cero? Es lo mismo que exige cajasDeRemesa */
export const cajaCompleta = (c: Pick<CajaEnEdicion, 'largoCm' | 'anchoCm' | 'altoCm' | 'pesoKg'>): boolean =>
  [c.largoCm, c.anchoCm, c.altoCm, c.pesoKg].every((v) => v !== null && v > 0)

export const unidadesDeCaja = (c: Pick<CajaEnEdicion, 'contenido'>): number => c.contenido.reduce((s, x) => s + x.unidades, 0)

export function resumirEncaje(lineas: LineaParaEncajar[], cajas: CajaEnEdicion[]): ResumenDeEncaje {
  const encajadas = new Map<string, number>()
  for (const c of cajas) for (const x of c.contenido) encajadas.set(x.sku, (encajadas.get(x.sku) ?? 0) + x.unidades)

  const porSku: Record<string, PorSku> = {}
  const descuadres: Cuadre['descuadres'] = lineas.map((l) => {
    const e = encajadas.get(l.sku) ?? 0
    porSku[l.sku] = { declaradas: l.unidades, encajadas: e, restantes: l.unidades - e }
    return { sku: l.sku, declaradas: l.unidades, encajadas: e, diferencia: l.unidades - e }
  })
  // Un SKU en las cajas que no está declarado es mercancía que se manda sin declarar: el descuadre peligroso
  const declarados = new Set(lineas.map((l) => l.sku))
  for (const [sku, e] of encajadas) {
    if (!declarados.has(sku)) {
      porSku[sku] = { declaradas: 0, encajadas: e, restantes: -e }
      descuadres.push({ sku, declaradas: 0, encajadas: e, diferencia: -e })
    }
  }

  const cuadre: Cuadre = { descuadres, cuadra: descuadres.every((d) => d.diferencia === 0) }
  const sinMedidas = cajas.filter((c) => !cajaCompleta(c)).map((c) => c.numero)
  const vacias = cajas.filter((c) => unidadesDeCaja(c) === 0).map((c) => c.numero)
  const estadoDeCajas: EstadoDeCajas = { cajas: cajas.length, sinMedidas: sinMedidas.length, vacias: vacias.length }
  const permiso = puedeAvanzar('encajando', 'lista', 'cliente', { lineas: lineas.length, cuadre, cajas: estadoDeCajas })

  return {
    declaradas: descuadres.reduce((s, d) => s + d.declaradas, 0),
    encajadas: descuadres.reduce((s, d) => s + d.encajadas, 0),
    pendientes: descuadres.reduce((s, d) => s + Math.max(0, d.diferencia), 0),
    sobrantes: descuadres.reduce((s, d) => s + Math.max(0, -d.diferencia), 0),
    porSku,
    cajas: cajas.length,
    sinMedidas,
    vacias,
    pesadas: cajas.filter((c) => (c.pesoKg ?? 0) > KG_DE_CARGA_PESADA).map((c) => c.numero),
    pesoTotalKg: Math.round(cajas.reduce((s, c) => s + (c.pesoKg ?? 0), 0) * 100) / 100,
    cuadre,
    estadoDeCajas,
    listo: permiso.puede,
    motivos: permiso.motivos.map((m) => m.texto),
  }
}

/** El número de la siguiente caja: uno más que el mayor que haya, así que nunca repite aunque se haya quitado alguna del medio */
export const numeroDeCajaNueva = (cajas: Array<Pick<CajaEnEdicion, 'numero'>>): number => Math.max(0, ...cajas.map((c) => c.numero)) + 1

/**
 * Lo que se lee de un campo de medida o de peso que ha escrito una persona.
 *
 * Acepta la coma («12,5»), porque quien teclea en español la usa, y devuelve null para lo vacío y para
 * lo que no sea un número mayor que cero —un cero en una medida es un campo sin rellenar, no una medida—.
 */
export function leerMedida(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/**
 * Por qué NO se pueden tocar las cajas en este paso, dicho a quien tiene el enlace. Está aquí y no en
 * el módulo del servidor porque lo necesita también el navegador, y aquel arrastra la base de datos.
 */
export function porQueNoSePuedeEncajar(estado: EstadoRemesa): string {
  switch (estado) {
    case 'borrador':
    case 'aprobada':
      return 'Todavía no se puede encajar este envío. Liberty Seller te avisará cuando esté listo.'
    case 'lista':
      return 'Ya has terminado de encajar este envío. Si hay que corregir algo, avisa a Liberty Seller.'
    default:
      return 'Este envío ya ha salido: no se pueden cambiar las cajas.'
  }
}
