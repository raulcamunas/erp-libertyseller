/**
 * AMAZON ADS · LA ESTRUCTURA DE CAMPAÑAS DE UN PRODUCTO (SOP v5, secciones 03, 04, 08 y 09).
 *
 * Funciones PURAS: de un producto, un presupuesto y una puja salen las campañas que hay que crear, con su nombre, su presupuesto, su puja y su configuración. No habla con Amazon ni con la base:
 * lo mismo que enseña la VISTA PREVIA es lo que luego se manda a crear, porque las dos salen de aquí.
 *
 *
 * ============ LAS CAMPAÑAS ============
 *
 *   AUTO RADAR                    descubre       no se apaga nunca
 *   MANUAL AMPLIA                 amplifica      solo entra lo que venga de un dato de la Automática
 *   MANUAL EXACTA / DOMINIO       gana posición  las 4-5 keywords de mayor impacto, pujas agresivas
 *   MANUAL EXACTA / ESTABILIDAD   sostiene       el resto con historial: NO se crea el día 1 (no hay historial)
 *   ATAQUE ASIN                   ocupa fichas   en paralelo al embudo
 *
 * El botón crea las CUATRO que tienen sentido el primer día. ESTABILIDAD nace cuando haya keywords con historial que consolidar.
 *
 *
 * ============ NOMBRES: «ASIN | SKU | RESUMEN TÍTULO | ESTRATEGIA» ============
 *
 * Sin excepciones, y el RESUMEN es idéntico en todas las campañas del mismo producto para poder filtrarlas juntas.
 *
 *
 * ============ VALORES DE ARRANQUE ============
 *
 * Los porcentajes de reparto y los factores de puja son los «VALOR DE ARRANQUE PROPUESTO» del SOP (o, donde el SOP dice «reducida» o «agresiva» sin número, uno razonable marcado como tal en
 * `nota`). Se convierten en doctrina cuando se firma la ficha de cuenta; mientras tanto la vista previa los enseña antes de crear nada.
 */

export const ROLES = ['AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD', 'ATAQUE ASIN'] as const
export type Rol = (typeof ROLES)[number]

/** Las que crea el botón el primer día */
export const ROLES_DE_ARRANQUE: readonly Rol[] = ['AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'ATAQUE ASIN']

/** El máximo que admite Amazon para el nombre de una campaña */
export const LARGO_MAXIMO_NOMBRE = 128

/** El presupuesto diario mínimo de una campaña (Amazon no admite menos de 1 en la moneda de la cuenta) */
export const PRESUPUESTO_MINIMO_CAMPANA = 1

/** La puja mínima que acepta Amazon por clic */
export const PUJA_MINIMA = 0.02

/** Los tipos de segmentación automática de Amazon y cómo se llaman en Seller Central */
export type TipoDeTargetAuto = 'QUERY_HIGH_REL_MATCHES' | 'QUERY_BROAD_REL_MATCHES' | 'ASIN_SUBSTITUTE_RELATED' | 'ASIN_ACCESSORY_RELATED'

export interface TargetAuto {
  tipo: TipoDeTargetAuto
  /** El nombre en Seller Central */
  nombre: string
  activo: boolean
  /** Multiplicador sobre la puja base */
  factorDePuja: number
}

export interface CampanaPlan {
  rol: Rol
  nombre: string
  targetingType: 'AUTO' | 'MANUAL'
  presupuestoDiario: number
  /** Porcentaje del presupuesto total del producto, ya normalizado a las campañas elegidas */
  repartoPct: number
  /** La puja por defecto del grupo de anuncios */
  pujaBase: number
  /** LEGACY_FOR_SALES = «puja dinámica: solo reducir», lo que pide el SOP en todas */
  estrategiaPuja: 'LEGACY_FOR_SALES'
  /** Ajuste de puja para el TOP de búsquedas, en % */
  topBusquedasPct: number
  grupo: string
  /** Solo en la automática: qué grupos de segmentación van encendidos y a qué puja */
  targetsAuto: TargetAuto[] | null
  /** Una línea para la vista previa: por qué esta configuración */
  nota: string
}

export interface ProductoParaEstructura {
  asin: string
  sku: string
  resumen: string
}

/** La campaña tal y como se llama en Seller Central */
export function nombreDeCampana(p: ProductoParaEstructura, rol: Rol): string {
  return `${p.asin.trim()} | ${p.sku.trim()} | ${p.resumen.trim()} | ${rol}`
}

const PALABRAS_VACIAS = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'CON', 'PARA', 'POR', 'EN', 'UN', 'UNA', 'THE', 'OF', 'AND', 'FOR', 'WITH', 'A', 'PACK', 'SET'])

/**
 * Un RESUMEN corto en mayúsculas a partir del título del listing: las 2-3 primeras palabras con contenido, sin tildes ni signos. Es una PROPUESTA que la persona corrige: el SOP dice que el resumen
 * «no es el título del listing, es una descripción corta», y eso lo decide quien conoce el producto.
 */
export function resumenDesdeTitulo(titulo: string | null | undefined, maximoPalabras = 3, maximoCaracteres = 28): string {
  if (!titulo) return ''
  const limpio = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
  const palabras = limpio.split(/\s+/).filter((w) => w && !PALABRAS_VACIAS.has(w))
  let resumen = ''
  for (const w of palabras.slice(0, maximoPalabras)) {
    const siguiente = resumen ? `${resumen} ${w}` : w
    if (siguiente.length > maximoCaracteres) break
    resumen = siguiente
  }
  return resumen
}

/** El RESUMEN válido para un nombre de campaña: mayúsculas, sin el separador «|» (que rompería el filtro por estrategia) y sin saltos de línea */
export function resumenNormalizado(texto: string): string {
  return texto.replace(/[|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

/**
 * Cuánto pesa cada campaña en el reparto del presupuesto (SOP sección 09, «Reparto de presupuesto en lanzamiento»): AMPLIA 35 %, EXACTA 25 %, AUTO 15 %, ATAQUE 10 %.
 * La EXACTA se parte en Dominio y Estabilidad (15 + 10) si se piden las dos.
 */
function pesos(roles: readonly Rol[]): Map<Rol, number> {
  const conEstabilidad = roles.includes('MANUAL EXACTA / ESTABILIDAD')
  const base: Record<Rol, number> = {
    'MANUAL AMPLIA': 35,
    'MANUAL EXACTA / DOMINIO': conEstabilidad ? 15 : 25,
    'MANUAL EXACTA / ESTABILIDAD': 10,
    'AUTO RADAR': 15,
    'ATAQUE ASIN': 10,
  }
  return new Map(roles.map((r) => [r, base[r]]))
}

const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * Reparte el presupuesto diario del producto entre las campañas elegidas. Cada una recibe primero el mínimo de Amazon y el resto se reparte según los pesos del SOP; el céntimo de redondeo
 * va a la de mayor presupuesto para que la suma sea EXACTAMENTE el total pedido. null si el total no da para el mínimo de todas.
 */
export function repartoDePresupuesto(total: number, roles: readonly Rol[]): Array<{ rol: Rol; presupuesto: number; pct: number }> | null {
  if (roles.length === 0 || !(total > 0)) return null
  if (total < roles.length * PRESUPUESTO_MINIMO_CAMPANA) return null
  const p = pesos(roles)
  const suma = [...p.values()].reduce((a, b) => a + b, 0)
  // Primero el mínimo a cada una y luego el resto, repartido por pesos: así NINGUNA baja del mínimo y la suma sale exacta
  const resto = total - roles.length * PRESUPUESTO_MINIMO_CAMPANA
  let filas = roles.map((rol) => ({ rol, presupuesto: redondear(PRESUPUESTO_MINIMO_CAMPANA + (resto * (p.get(rol) ?? 0)) / suma), pct: redondear(((p.get(rol) ?? 0) / suma) * 100) }))
  // El redondeo a céntimos puede dejar un céntimo de más o de menos: se lo lleva la de mayor presupuesto
  const desvio = redondear(total - filas.reduce((a, f) => a + f.presupuesto, 0))
  if (desvio !== 0) {
    const mayor = [...filas].sort((a, b) => b.presupuesto - a.presupuesto)[0]
    filas = filas.map((f) => (f === mayor ? { ...f, presupuesto: redondear(f.presupuesto + desvio) } : f))
  }
  return filas
}

export interface OpcionesDePlan {
  /** Presupuesto diario TOTAL del producto, en la moneda de la cuenta */
  presupuestoDiario: number
  /** La puja de referencia: de ella salen las de cada campaña */
  pujaBase: number
  roles?: readonly Rol[]
}

export type ResultadoDelPlan = { ok: true; campanas: CampanaPlan[] } | { ok: false; error: string }

/**
 * LAS CAMPAÑAS QUE HAY QUE CREAR PARA UN PRODUCTO, con su configuración del SOP sección 09.
 *
 * Valida lo que Amazon rechazaría después (nombre de más de 128 caracteres, presupuesto por debajo del mínimo, puja por debajo de 0,02) para decirlo ANTES de tocar la cuenta.
 */
export function planDeEstructura(producto: ProductoParaEstructura, opciones: OpcionesDePlan): ResultadoDelPlan {
  const roles = opciones.roles ?? ROLES_DE_ARRANQUE
  if (!producto.asin.trim() || !producto.sku.trim() || !producto.resumen.trim()) return { ok: false, error: 'Faltan el ASIN, el SKU o el resumen del producto.' }
  if (/[|]/.test(producto.resumen)) return { ok: false, error: 'El resumen no puede llevar el carácter «|»: separa los campos del nombre.' }
  if (!(opciones.pujaBase >= PUJA_MINIMA)) return { ok: false, error: `La puja base mínima es ${PUJA_MINIMA.toFixed(2)}.` }

  const reparto = repartoDePresupuesto(opciones.presupuestoDiario, roles)
  if (!reparto) return { ok: false, error: `Con ${roles.length} campañas el presupuesto diario mínimo es ${roles.length * PRESUPUESTO_MINIMO_CAMPANA}: Amazon pide al menos ${PRESUPUESTO_MINIMO_CAMPANA} por campaña.` }

  const puja = (factor: number) => Math.max(PUJA_MINIMA, redondear(opciones.pujaBase * factor))
  const campanas: CampanaPlan[] = []

  for (const { rol, presupuesto, pct } of reparto) {
    const nombre = nombreDeCampana(producto, rol)
    if (nombre.length > LARGO_MAXIMO_NOMBRE) return { ok: false, error: `El nombre «${nombre.slice(0, 50)}…» pasa de ${LARGO_MAXIMO_NOMBRE} caracteres: acorta el resumen.` }
    const comun = { rol, nombre, presupuestoDiario: presupuesto, repartoPct: pct, estrategiaPuja: 'LEGACY_FOR_SALES' as const }

    switch (rol) {
      case 'AUTO RADAR':
        campanas.push({
          ...comun,
          targetingType: 'AUTO',
          pujaBase: puja(1),
          topBusquedasPct: 0,
          grupo: 'AUTO',
          targetsAuto: [
            { tipo: 'QUERY_HIGH_REL_MATCHES', nombre: 'Coincidencia cercana', activo: true, factorDePuja: 1 },
            { tipo: 'ASIN_SUBSTITUTE_RELATED', nombre: 'Sustitutos', activo: true, factorDePuja: 0.85 },
            { tipo: 'QUERY_BROAD_REL_MATCHES', nombre: 'Coincidencia amplia', activo: true, factorDePuja: 0.8 },
            { tipo: 'ASIN_ACCESSORY_RELATED', nombre: 'Complementarios', activo: false, factorDePuja: 1 },
          ],
          nota: 'Radar permanente. Cercana a la puja base, Sustitutos −15 %, Amplia reducida (−20 %, valor de arranque), Complementarios apagado. Top of Search 0 %.',
        })
        break
      case 'MANUAL AMPLIA':
        campanas.push({
          ...comun,
          targetingType: 'MANUAL',
          pujaBase: puja(1),
          topBusquedasPct: 0,
          grupo: 'GENERAL',
          targetsAuto: null,
          nota: 'Sale vacía: las keywords entran cuando la Automática dé un dato (frase por defecto, un grupo de anuncios por clúster). Puja de referencia = la base.',
        })
        break
      case 'MANUAL EXACTA / DOMINIO':
        campanas.push({
          ...comun,
          targetingType: 'MANUAL',
          pujaBase: puja(1.2),
          topBusquedasPct: 15,
          grupo: 'DOMINIO',
          targetsAuto: null,
          nota: 'Para las 4-5 keywords de mayor impacto, con pujas agresivas (+20 %, valor de arranque) y Top of Search al 15 % (el SOP pide 10-20 %). Nace vacía: nada entra sin historial.',
        })
        break
      case 'MANUAL EXACTA / ESTABILIDAD':
        campanas.push({
          ...comun,
          targetingType: 'MANUAL',
          pujaBase: puja(0.9),
          topBusquedasPct: 0,
          grupo: 'ESTABILIDAD',
          targetsAuto: null,
          nota: 'Para sostener lo que ya funciona, con pujas moderadas (−10 %, valor de arranque) y Top of Search 0 %.',
        })
        break
      case 'ATAQUE ASIN':
        campanas.push({
          ...comun,
          targetingType: 'MANUAL',
          pujaBase: puja(0.6),
          topBusquedasPct: 0,
          grupo: 'FICHAS',
          targetsAuto: null,
          nota: 'Product targeting por bloques de ASINs rivales, con puja baja (−40 %, valor de arranque). Con menos de 25 reseñas el SOP pide bajarle el presupuesto al 5 %.',
        })
        break
    }
  }
  return { ok: true, campanas }
}

/**
 * Las campañas del plan que YA existen en la cuenta, comparando por nombre (sin mayúsculas ni espacios de más). Es lo que impide crear dos veces lo mismo si el botón se pulsa de nuevo o si una
 * creación quedó a medias.
 */
export function yaExistentes(plan: readonly CampanaPlan[], nombresDeLaCuenta: readonly string[]): Set<Rol> {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase()
  const hay = new Set(nombresDeLaCuenta.map(norm))
  return new Set(plan.filter((c) => hay.has(norm(c.nombre))).map((c) => c.rol))
}
