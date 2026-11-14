/**
 * AMAZON ADS · LOS UMBRALES DEL MOTOR QUE EL SOP NO FIJA (estimaciones configurables por cuenta). PURO.
 *
 * El SOP da número a algunas cosas y esos números viven en la ficha de cuenta, que se firma (muestra mínima, días entre cambios de puja, % y horas de subida de presupuesto…). Pero el motor necesita
 * además cortes que el SOP no escribe, o que la investigación de noviembre de 2026 (keepa-estudios/investigacion-seo-ppc-2026.md, §3.3) propone cambiar porque un umbral FIJO de clics negativiza
 * términos buenos en categorías de conversión baja:
 *
 *   NEGATIVIZAR   0 pedidos y clics ≥ 3 ÷ CVR de referencia, o gasto ≥ 1,5 × CPA objetivo (lo que llegue antes). Con un CVR del 10 % son 30 clics; con uno del 20 %, 15.
 *   IRRELEVANTE   el término no comparte ninguna palabra con el producto: se propone al primer clic, MARCADO PARA REVISAR (decidir si es otra cosa es criterio humano).
 *   PUJA          puja objetivo = ventas por clic × ACoS objetivo, solo con ≥ 1 ÷ CVR clics; bajar con ≥ 2 pedidos si el ACoS pasa de 1,2× el objetivo, como mucho un 25 % por ciclo; subir un 15 % si
 *                 el ACoS está por debajo de 0,7× el objetivo con ≥ 3 pedidos; sin pedidos y con ≥ 1 ÷ CVR clics, −15 %.
 *   COSECHAR      ≥ 3 pedidos en 30 días con ACoS ≤ objetivo (o los pedidos de la ficha con ≥ 1 ÷ CVR clics), con la negativa exacta en origen a la vez.
 *   VENTANA       se dejan fuera los 3 últimos días: Amazon sigue reajustando las conversiones (atribución a 7 días) y bajar una puja con los datos de ayer castiga términos buenos.
 *
 * Por eso: aquí están TODOS juntos, con su valor de partida y una nota; la pantalla los enseña marcados como ESTIMACIÓN y se cambian por cuenta (columna `umbrales` de `ads_motor_config`,
 * migración 305). Sin la migración, el motor usa estos valores de partida y lo dice.
 */

export interface UmbralesEstimados {
  /** CVR (pedidos ÷ clics) que se usa si ni la campaña, ni el producto, ni la cuenta tienen pedidos suficientes, en % */
  cvrPorDefectoPct: number
  /** Negativizar un término relevante sin pedidos con clics ≥ este número ÷ CVR */
  negativizarClicsPorCvr: number
  /** … o con gasto ≥ este múltiplo del CPA objetivo */
  negativizarGastoXCpa: number
  /** Proponer (para revisar) un término que no comparte ninguna palabra con el producto a partir de estos clics */
  irrelevanteClics: number
  /** Pedidos en la ventana para cosechar un término a EXACTA (con ACoS ≤ objetivo) */
  pedidosParaCosechar: number
  /** Subir puja si el ACoS está por debajo de este múltiplo del objetivo */
  subirSiAcosBajoX: number
  /** … con al menos estos pedidos */
  pedidosParaSubir: number
  /** % que se sube la puja de lo que rinde de sobra */
  subirPujaPct: number
  /** Bajar puja si el ACoS supera este múltiplo del objetivo */
  bajarSiAcosSobreX: number
  /** … con al menos estos pedidos (con menos, el ACoS es ruido) */
  pedidosParaBajar: number
  /** Lo máximo que baja una puja de golpe, en % */
  pujaMaxBajadaPct: number
  /** % que se baja la puja de lo que tiene clics suficientes y ningún pedido (sin llegar al tope de pausar) */
  bajarSinPedidosPct: number
  /** Una campaña «se queda corta» si gasta de media este % de su presupuesto diario o más */
  usoPresupuestoCortoPct: number
  /** Días más recientes que NO se leen (conversiones todavía sin cerrar) */
  diasSinCerrar: number
}

export const UMBRALES_DE_PARTIDA: UmbralesEstimados = {
  cvrPorDefectoPct: 10,
  negativizarClicsPorCvr: 3,
  negativizarGastoXCpa: 1.5,
  irrelevanteClics: 1,
  pedidosParaCosechar: 3,
  subirSiAcosBajoX: 0.7,
  pedidosParaSubir: 3,
  subirPujaPct: 15,
  bajarSiAcosSobreX: 1.2,
  pedidosParaBajar: 2,
  pujaMaxBajadaPct: 25,
  bajarSinPedidosPct: 15,
  usoPresupuestoCortoPct: 90,
  diasSinCerrar: 3,
}

type Unidad = 'x' | 'pedidos' | '%' | 'clics' | 'días' | '÷ CVR'

/** Lo que enseña la pantalla de cada umbral: nombre, nota, límites (los mismos que se validan al guardar) y de dónde sale el valor de partida */
export const DESCRIPCION_DE_UMBRALES: Record<keyof UmbralesEstimados, { grupo: 'Negativizar' | 'Cosechar' | 'Pujas' | 'Presupuesto' | 'Datos'; nombre: string; nota: string; min: number; max: number; paso: number; unidad: Unidad; fuente: string }> = {
  negativizarClicsPorCvr: { grupo: 'Negativizar', nombre: 'Clics sin pedido para excluir', nota: 'Veces los clics que cuesta un pedido. Con 3 hay un 95 % de seguridad de que el término no convierte.', min: 1, max: 6, paso: 0.5, unidad: '÷ CVR', fuente: 'Investigación nov 2026, regla 2' },
  negativizarGastoXCpa: { grupo: 'Negativizar', nombre: '… o gasto sin pedido', nota: '× el CPA objetivo (precio × ACoS objetivo). Lo que llegue antes, clics o gasto.', min: 0.5, max: 5, paso: 0.1, unidad: 'x', fuente: 'Estimación' },
  irrelevanteClics: { grupo: 'Negativizar', nombre: 'Término sin relación con el producto', nota: 'Clics a partir de los que se propone, MARCADO PARA REVISAR: no comparte ninguna palabra con el producto.', min: 1, max: 20, paso: 1, unidad: 'clics', fuente: 'SOP (al primer clic, criterio humano)' },
  pedidosParaCosechar: { grupo: 'Cosechar', nombre: 'Pedidos para pasar a EXACTA', nota: 'En 30 días y con ACoS ≤ objetivo. También pasa con los pedidos de la ficha si tiene ≥ 1 ÷ CVR clics.', min: 1, max: 10, paso: 1, unidad: 'pedidos', fuente: 'Estimación (Amazon usa 5 en 14 días)' },
  subirSiAcosBajoX: { grupo: 'Pujas', nombre: 'Subir puja si el ACoS es menor que', nota: '× el objetivo: hay margen para ganar posición.', min: 0.3, max: 1, paso: 0.05, unidad: 'x', fuente: 'Estimación' },
  pedidosParaSubir: { grupo: 'Pujas', nombre: '… con al menos', nota: 'Pedidos en 14 días.', min: 1, max: 10, paso: 1, unidad: 'pedidos', fuente: 'Estimación' },
  subirPujaPct: { grupo: 'Pujas', nombre: 'Cuánto se sube', nota: 'Por ciclo, sin pasar de la puja objetivo (ventas por clic × ACoS objetivo).', min: 5, max: 50, paso: 5, unidad: '%', fuente: 'Estimación (15-20 %)' },
  bajarSiAcosSobreX: { grupo: 'Pujas', nombre: 'Bajar puja si el ACoS supera', nota: '× el objetivo. Se baja hacia la puja objetivo.', min: 1, max: 3, paso: 0.05, unidad: 'x', fuente: 'Investigación nov 2026, regla 5' },
  pedidosParaBajar: { grupo: 'Pujas', nombre: '… con al menos', nota: 'Pedidos en 14 días: con uno solo el ACoS es casualidad.', min: 1, max: 10, paso: 1, unidad: 'pedidos', fuente: 'Investigación nov 2026, regla 4' },
  pujaMaxBajadaPct: { grupo: 'Pujas', nombre: 'Bajada máxima de golpe', nota: 'Para no matar un término por ruido.', min: 5, max: 50, paso: 5, unidad: '%', fuente: 'Estimación' },
  bajarSinPedidosPct: { grupo: 'Pujas', nombre: 'Bajada sin pedidos', nota: 'Con ≥ 1 ÷ CVR clics y ningún pedido, sin llegar al tope de excluir o pausar.', min: 5, max: 50, paso: 5, unidad: '%', fuente: 'Estimación' },
  usoPresupuestoCortoPct: { grupo: 'Presupuesto', nombre: 'Se queda corta si gasta', nota: '% del presupuesto diario de media en 7 días. Si además cumple el ACoS, se sube el % de la ficha.', min: 50, max: 100, paso: 5, unidad: '%', fuente: 'Investigación nov 2026, regla 9' },
  cvrPorDefectoPct: { grupo: 'Datos', nombre: 'CVR si no hay datos', nota: 'Se usa el de la campaña, si no el del producto, si no el de la cuenta (con ≥ 3 pedidos en 60 días). Si tampoco, este.', min: 1, max: 50, paso: 1, unidad: '%', fuente: 'Estimación' },
  diasSinCerrar: { grupo: 'Datos', nombre: 'Días recientes que no se leen', nota: 'Amazon reajusta las conversiones durante días: se excluyen de términos y pujas.', min: 0, max: 7, paso: 1, unidad: 'días', fuente: 'Investigación nov 2026 (2-3 días)' },
}

const ENTEROS: ReadonlyArray<keyof UmbralesEstimados> = ['irrelevanteClics', 'pedidosParaCosechar', 'pedidosParaSubir', 'pedidosParaBajar', 'diasSinCerrar']

/**
 * Lo que llega de la base (o de la pantalla) → unos umbrales válidos. Lo que falta o no es un número dentro de sus límites se queda con el valor de partida: un umbral roto no puede dejar al motor
 * proponiendo disparates.
 */
export function umbralesValidos(crudo: unknown): UmbralesEstimados {
  const fuente = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>
  const salida = { ...UMBRALES_DE_PARTIDA }
  for (const clave of Object.keys(UMBRALES_DE_PARTIDA) as Array<keyof UmbralesEstimados>) {
    const v = fuente[clave]
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : Number.NaN
    const d = DESCRIPCION_DE_UMBRALES[clave]
    if (Number.isFinite(n) && n >= d.min && n <= d.max) salida[clave] = ENTEROS.includes(clave) ? Math.round(n) : n
  }
  return salida
}

/** ¿Todos con su valor de partida? Para decir en pantalla «ajustados para esta cuenta» */
export function sonDePartida(u: UmbralesEstimados): boolean {
  return (Object.keys(UMBRALES_DE_PARTIDA) as Array<keyof UmbralesEstimados>).every((k) => u[k] === UMBRALES_DE_PARTIDA[k])
}

/**
 * EL CVR DE REFERENCIA (pedidos ÷ clics) con el que se miden los umbrales de clics: el de la campaña; si no tiene pedidos suficientes, el del producto; si tampoco, el de la cuenta; y si nada, el de
 * partida. «Suficientes» = 3 pedidos (con 1 o 2, un pedido más cambia el CVR a la mitad o al doble). Siempre entre el 1 % y el 60 % para que un dato raro no dispare ni anule las reglas.
 */
export function cvrDeReferencia(
  niveles: { campana?: { clics: number; pedidos: number } | null; producto?: { clics: number; pedidos: number } | null; cuenta?: { clics: number; pedidos: number } | null },
  porDefectoPct: number,
  pedidosMinimos = 3
): { cvr: number; fuente: 'campaña' | 'producto' | 'cuenta' | 'estimado' } {
  const acotar = (x: number) => Math.min(0.6, Math.max(0.01, x))
  for (const fuente of ['campana', 'producto', 'cuenta'] as const) {
    const n = niveles[fuente]
    if (n && n.pedidos >= pedidosMinimos && n.clics > 0) return { cvr: acotar(n.pedidos / n.clics), fuente: fuente === 'campana' ? 'campaña' : fuente }
  }
  return { cvr: acotar(porDefectoPct / 100), fuente: 'estimado' }
}

/** Los clics que «cuesta» un pedido con ese CVR, redondeados hacia arriba (1 ÷ CVR) */
export const clicsPorPedido = (cvr: number): number => Math.ceil(1 / Math.max(0.01, cvr) - 1e-9)
