/**
 * TESORERÍA · EL EXTRACTO DE PAYSET Y QUÉ ES CADA MOVIMIENTO DEL BANCO.
 *
 * PURO: no habla con Zoho ni con la base. Dos piezas:
 *
 *   1. `leerExtractoPayset`  el CSV del «Accounting statement» de Payset (todas las cuentas a la vez: EUR, AED, USD), fila a fila.
 *   2. `decidir`             para las líneas de banco que en Zoho siguen SIN CASAR (de cualquier cuenta: Payset o Wio), qué es cada una.
 *
 * Solo se decide lo que es SEGURO. Lo dudoso se queda sin casar y aparece en «Cobros y banco» para hacerlo a mano.
 *
 *
 * ============ LAS REGLAS, EN ORDEN ============
 *
 *   Comisión         sale dinero hacia «Pay Set Limited», «(fee)», «Foreign exchange transaction fee», «Subscription fee»  → gasto en Cargos y tasas bancarias
 *   Cambio de moneda sale en una moneda y entra en otra el mismo día (±1), con pista en el texto («EUR to AED», «exchange»…)  → UNA transferencia entre las dos cuentas, con los dos importes
 *   Otra pata        entra dinero y ya hay en esa cuenta una transferencia apuntada a mano por el mismo importe (la otra pata)  → se casan
 *   Envío propio     sale de Payset hacia «Liberty Seller…» y hay una sola cuenta que no es de Payset en esa moneda (Wio)  → transferencia a Wio
 *   Cobro            entra dinero de un cliente conocido (por cobros anteriores o por el nombre) y tiene una factura abierta de ese importe  → cobro de esa factura
 *                    · si llega hasta un 7 % menos (los bancos del SWIFT se quedan una parte), cobro de la factura entera con la diferencia como comisión
 *                    · si no se sabe quién es pero hay UNA sola factura abierta de ese importe exacto y el nombre se parece  → cobro
 *   Gasto conocido   sale dinero con el mismo texto que un gasto ya clasificado antes (Zoho, Metricool…)  → la misma cuenta de gasto
 *   Lo demás         se queda para revisar, con el porqué
 */

export interface FilaPayset {
  /** «TX-…»: único en Payset. Va a Zoho como referencia, y es lo que impide importar dos veces lo mismo */
  ref: string
  fecha: string
  /** La cuenta de Payset (IBAN) */
  cuenta: string
  contraparte: string
  descripcion: string
  /** Positivo si entra, negativo si sale */
  importe: number
  saldo: number | null
}

/** Una línea de CSV con comillas («"GFY LOGISTIC, S.L."») */
function campos(linea: string): string[] {
  const out: string[] = []
  let actual = ''
  let entre = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (entre) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else if (c === '"') entre = false
      else actual += c
    } else if (c === '"') entre = true
    else if (c === ',') {
      out.push(actual)
      actual = ''
    } else actual += c
  }
  out.push(actual)
  return out.map((s) => s.trim())
}

const MESES: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }

/** «Nov 10, 2026» → «2026-11-10». También acepta ya «2026-11-10» y «10/11/2026» */
export function fechaPayset(s: string): string | null {
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = t.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/)
  if (m && MESES[m[1].toLowerCase()]) return `${m[3]}-${MESES[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`
  const e = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (e) return `${e[3]}-${e[2].padStart(2, '0')}-${e[1].padStart(2, '0')}`
  return null
}

const numero = (s: string): number | null => {
  const t = s.replace(/[^\d.,-]/g, '')
  if (!t) return null
  const n = Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** El CSV del extracto de Payset. Error claro si no lo es (para que no se suba el de otro banco pensando que es este) */
export function leerExtractoPayset(texto: string): { ok: true; filas: FilaPayset[] } | { ok: false; error: string } {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lineas.length === 0) return { ok: false, error: 'El fichero está vacío.' }
  const cab = campos(lineas[0]).map((c) => c.toLowerCase())
  const col = (nombre: string) => cab.indexOf(nombre)
  const i = { ref: col('payset id'), fecha: col('date'), cuenta: col('account'), contra: col('counterparty name'), desc: col('description'), entra: col('money in'), sale: col('money out'), saldo: col('balance') }
  if (i.ref < 0 || i.fecha < 0 || i.cuenta < 0 || i.entra < 0 || i.sale < 0) {
    return { ok: false, error: 'No parece un extracto de Payset: faltan las columnas «Payset ID», «Date», «Account», «Money in» y «Money out». Descárgalo como «Accounting statement» en CSV.' }
  }
  const filas: FilaPayset[] = []
  for (const [n, l] of lineas.slice(1).entries()) {
    const c = campos(l)
    const fecha = fechaPayset(c[i.fecha] ?? '')
    const entra = numero(c[i.entra] ?? '')
    const sale = numero(c[i.sale] ?? '')
    if (!fecha) return { ok: false, error: `Fila ${n + 2}: no se entiende la fecha «${c[i.fecha]}».` }
    if (entra == null && sale == null) return { ok: false, error: `Fila ${n + 2}: no tiene importe.` }
    filas.push({
      ref: c[i.ref],
      fecha,
      cuenta: (c[i.cuenta] ?? '').replace(/\s+/g, ''),
      contraparte: i.contra >= 0 ? c[i.contra] ?? '' : '',
      descripcion: i.desc >= 0 ? c[i.desc] ?? '' : '',
      importe: entra != null && entra !== 0 ? Math.abs(entra) : -Math.abs(sale ?? 0),
      saldo: i.saldo >= 0 ? numero(c[i.saldo] ?? '') : null,
    })
  }
  return { ok: true, filas }
}

/** Lo que Payset pone en la descripción: «Incoming transfer; GFY LOGISTIC, S.L.; Tapas Party . Noviembre 2026» → el concepto, sin el tipo ni el nombre repetidos */
export function conceptoPayset(f: FilaPayset): string {
  const partes = f.descripcion.split(';').map((s) => s.trim()).filter(Boolean)
  return (partes.length >= 3 ? partes.slice(2).join('; ') : partes[partes.length - 1] ?? '').slice(0, 100)
}

/** La descripción con la que va a Zoho: el pagador delante del concepto. Al casar un cobro Zoho pisa el pagador con el nombre del cliente, y así no se pierde (de aquí se aprende quién paga por quién) */
export function descripcionParaZoho(f: FilaPayset): string {
  const c = conceptoPayset(f)
  return (f.contraparte && !c.toLowerCase().includes(f.contraparte.toLowerCase()) ? `${f.contraparte} · ${c}` : c).slice(0, 100)
}

// ======================================================================
//   QUÉ ES CADA LÍNEA
// ======================================================================

/** Nombre para comparar: sin tildes, sin «From», sin forma jurídica ni puntuación. «From GFY LOGISTIC S.L.» y «GFY LOGISTIC, S.L.» dan lo mismo */
export function nombreNormalizado(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^from\s+/, '')
    .replace(/\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?|sociedad limitada|sociedad limitad|limitad[ao]?|ltd\.?|llc|fzco|inc\.?|s\.?a\.? de c\.?v\.?|sl|sa)\b/g, ' ')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PALABRAS_VACIAS = new Set(['de', 'la', 'el', 'y', 'en', 'los', 'las', 'del', 'por', 'para', 'con', 'factura', 'fra', 'fac', 'pago', 'invoice', '2025', '2026', '2027', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'liberty', 'seller', 'enviado', 'banco', 'transfer', 'incoming'])

const palabras = (s: string) => new Set(nombreNormalizado(s).split(' ').filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w)))

/** ¿Comparten alguna palabra con sustancia? «Tapas Party . Noviembre» y «Tapas Party | Noviembre 2026» sí; «Enviado por Banco Santander» y «Eduardo» no */
export function seParecen(a: string, b: string): boolean {
  // «COBOFAMILY S.L.» y «Cobo Family»: juntas, una contiene a la otra
  const [ja, jb] = [nombreNormalizado(a).replace(/ /g, ''), nombreNormalizado(b).replace(/ /g, '')]
  if ((jb.length >= 5 && ja.includes(jb)) || (ja.length >= 5 && jb.includes(ja))) return true
  const pa = palabras(a)
  for (const w of palabras(b)) if (pa.has(w)) return true
  return false
}

export interface Linea {
  id: string
  cuentaId: string
  moneda: string
  fecha: string
  importe: number
  entrada: boolean
  payee: string
  concepto: string
}

export interface CuentaDeBanco {
  id: string
  nombre: string
  moneda: string
  esPayset: boolean
}

export interface FacturaAbierta {
  id: string
  numero: string
  clienteId: string
  cliente: string
  moneda: string
  saldo: number
  fecha: string
}

export interface Aprendido {
  /** nombreNormalizado del pagador o del concepto */
  clave: string
  clienteId?: string
  cuentaGasto?: string
}

/** Una transferencia apuntada a mano en una cuenta (la pata que espera a que llegue la línea del banco) */
export interface PataPendiente {
  id: string
  cuentaId: string
  fecha: string
  importe: number
}

export type Accion =
  | { tipo: 'cobro'; linea: Linea; factura: FacturaAbierta; comision: number; porque: string }
  | { tipo: 'gasto'; linea: Linea; cuentaGasto: string; porque: string }
  | { tipo: 'cambio'; sale: Linea; entra: Linea; porque: string }
  | { tipo: 'casar'; linea: Linea; pata: PataPendiente; porque: string }
  | { tipo: 'envio'; linea: Linea; destino: CuentaDeBanco; porque: string }
  | { tipo: 'revisar'; linea: Linea; porque: string }

export interface Contexto {
  cuentas: CuentaDeBanco[]
  facturas: FacturaAbierta[]
  aprendido: Aprendido[]
  patas: PataPendiente[]
  /** El id de «Cargos y tasas bancarias» */
  cuentaComisiones: string
}

const COMISION = /^fee transfer|\(fee\)\s*$|foreign exchange transaction fee|subscription fee|^fee\b|bank charge|commission/i
const PISTA_DE_CAMBIO = /\b([A-Z]{3})\s+to\s+([A-Z]{3})\b|exchange|conversion|convert|\bfx\b|cambio de divisa/i
const centimos = (n: number) => Math.round(n * 100)
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const texto = (l: Linea) => `${l.payee} ${l.concepto}`.trim()
const MAX_SWIFT = 0.07

/** Quién es el cliente de un cobro, por lo aprendido (cobros anteriores de ese pagador) */
/**
 * Lo aprendido se busca así: el concepto, IGUAL al de una línea anterior («From FEELING STREET S.L.» en Wio, que no cambia de un mes a otro); y el
 * pagador, CONTENIDO en el texto de una anterior. Hace falta lo segundo porque al casar un cobro Zoho cambia el pagador por el nombre del cliente y el
 * original solo queda en la descripción, donde la importación lo deja escrito («GFY LOGISTIC, S.L. · Tapas Party . Noviembre 2026»).
 */
function buscar(l: Linea, aprendido: Aprendido[], vale: (a: Aprendido) => boolean): Aprendido | undefined {
  const concepto = nombreNormalizado(l.concepto)
  const pagador = nombreNormalizado(l.payee)
  return (
    (concepto ? aprendido.find((a) => vale(a) && a.clave === concepto) : undefined) ??
    (pagador.length >= 5 ? aprendido.find((a) => vale(a) && (a.clave === pagador || ` ${a.clave} `.includes(` ${pagador} `))) : undefined)
  )
}

const clienteAprendido = (l: Linea, aprendido: Aprendido[]): string | null => buscar(l, aprendido, (a) => !!a.clienteId)?.clienteId ?? null
const gastoAprendido = (l: Linea, aprendido: Aprendido[]): string | null => buscar(l, aprendido, (a) => !!a.cuentaGasto)?.cuentaGasto ?? null

export function decidir(lineas: readonly Linea[], ctx: Contexto): Accion[] {
  const cuenta = new Map(ctx.cuentas.map((c) => [c.id, c]))
  const hechas = new Set<string>()
  const facturasUsadas = new Set<string>()
  const patasUsadas = new Set<string>()
  const acciones: Accion[] = []
  const dar = (a: Accion, ...ids: string[]) => {
    acciones.push(a)
    for (const id of ids) hechas.add(id)
  }
  const libres = () => lineas.filter((l) => !hechas.has(l.id))

  // 1 · Comisiones
  for (const l of libres()) {
    if (!l.entrada && (COMISION.test(l.concepto) || /pay ?set limited/i.test(l.payee))) dar({ tipo: 'gasto', linea: l, cuentaGasto: ctx.cuentaComisiones, porque: 'Comisión del banco' }, l.id)
  }

  // 2 · Cambios de moneda: la salida y la entrada, en cuentas de distinta moneda del mismo banco
  for (const s of libres().filter((l) => !l.entrada && PISTA_DE_CAMBIO.test(texto(l)))) {
    if (hechas.has(s.id)) continue
    const cs = cuenta.get(s.cuentaId)
    const pareja = libres()
      .filter((e) => e.entrada && e.id !== s.id && Math.abs(dias(s.fecha, e.fecha)) <= 1)
      .filter((e) => {
        const ce = cuenta.get(e.cuentaId)
        return !!cs && !!ce && ce.moneda !== cs.moneda && ce.esPayset === cs.esPayset && PISTA_DE_CAMBIO.test(texto(e))
      })
      // Si el texto dice «EUR to AED», la entrada tiene que ser en AED
      .filter((e) => {
        const m = texto(s).match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/)
        return !m || cuenta.get(e.cuentaId)?.moneda === m[2]
      })
      .sort((a, b) => Math.abs(dias(s.fecha, a.fecha)) - Math.abs(dias(s.fecha, b.fecha)))
    if (pareja.length >= 1) dar({ tipo: 'cambio', sale: s, entra: pareja[0], porque: `Cambio de ${cs?.moneda} a ${cuenta.get(pareja[0].cuentaId)?.moneda}` }, s.id, pareja[0].id)
  }

  // 3 · La otra pata de una transferencia ya apuntada
  for (const l of libres()) {
    const pata = ctx.patas.find((p) => !patasUsadas.has(p.id) && p.cuentaId === l.cuentaId && centimos(p.importe) === centimos(l.importe) && dias(p.fecha, l.fecha) >= -2 && dias(p.fecha, l.fecha) <= 10)
    if (pata && l.entrada) {
      patasUsadas.add(pata.id)
      dar({ tipo: 'casar', linea: l, pata, porque: 'Llegada de una transferencia entre cuentas propias' }, l.id)
    }
  }

  // 4 · Envíos de Payset a la cuenta propia de Wio
  for (const l of libres()) {
    const c = cuenta.get(l.cuentaId)
    if (l.entrada || !c?.esPayset || !/liberty seller/i.test(texto(l))) continue
    const destinos = ctx.cuentas.filter((d) => !d.esPayset && d.moneda === c.moneda)
    if (destinos.length === 1) dar({ tipo: 'envio', linea: l, destino: destinos[0], porque: `Envío a ${destinos[0].nombre} (${c.moneda})` }, l.id)
    else dar({ tipo: 'revisar', linea: l, porque: `Parece un envío a una cuenta propia, pero hay ${destinos.length} cuentas en ${c.moneda} que no son de Payset: elige a cuál` }, l.id)
  }

  // 5 · Cobros
  for (const l of libres().filter((x) => x.entrada)) {
    const abiertas = ctx.facturas.filter((f) => !facturasUsadas.has(f.id) && f.moneda === l.moneda)
    const clienteId = clienteAprendido(l, ctx.aprendido) ?? (() => {
      const porNombre = [...new Set(abiertas.filter((f) => seParecen(texto(l), f.cliente)).map((f) => f.clienteId))]
      return porNombre.length === 1 ? porNombre[0] : null
    })()
    const masAntigua = (fs: FacturaAbierta[]) => [...fs].sort((a, b) => a.fecha.localeCompare(b.fecha))[0]

    if (clienteId) {
      const suyas = abiertas.filter((f) => f.clienteId === clienteId)
      const exacta = suyas.filter((f) => centimos(f.saldo) === centimos(l.importe))
      if (exacta.length) {
        const f = masAntigua(exacta)
        facturasUsadas.add(f.id)
        dar({ tipo: 'cobro', linea: l, factura: f, comision: 0, porque: `Factura ${f.numero} de ${f.cliente}, mismo importe` }, l.id)
        continue
      }
      const recortada = suyas.filter((f) => f.saldo > l.importe && f.saldo - l.importe <= f.saldo * MAX_SWIFT)
      if (recortada.length === 1) {
        const f = recortada[0]
        facturasUsadas.add(f.id)
        const comision = Math.round((f.saldo - l.importe) * 100) / 100
        dar({ tipo: 'cobro', linea: l, factura: f, comision, porque: `Factura ${f.numero} de ${f.cliente}: llegan ${comision.toFixed(2)} menos, comisión de los bancos intermediarios` }, l.id)
        continue
      }
      const nombre = ctx.facturas.find((f) => f.clienteId === clienteId)?.cliente ?? 'este cliente'
      dar({ tipo: 'revisar', linea: l, porque: suyas.length ? `${nombre} tiene facturas abiertas, pero ninguna de ${l.importe.toFixed(2)} ${l.moneda}: ¿pago parcial, de varias facturas o duplicado?` : `${nombre} no tiene ninguna factura abierta en ${l.moneda}: ¿pago duplicado o anticipo?` }, l.id)
      continue
    }

    const porImporte = abiertas.filter((f) => centimos(f.saldo) === centimos(l.importe))
    if (porImporte.length === 1 && (seParecen(texto(l), porImporte[0].cliente) || seParecen(texto(l), porImporte[0].numero))) {
      const f = porImporte[0]
      facturasUsadas.add(f.id)
      dar({ tipo: 'cobro', linea: l, factura: f, comision: 0, porque: `Única factura abierta de ese importe (${f.numero}) y el concepto coincide` }, l.id)
      continue
    }
    dar({ tipo: 'revisar', linea: l, porque: porImporte.length === 1 ? `¿Es la factura ${porImporte[0].numero} de ${porImporte[0].cliente}? Coincide el importe pero no el nombre de quien paga` : porImporte.length > 1 ? `Hay ${porImporte.length} facturas abiertas de ${l.importe.toFixed(2)} ${l.moneda}: elige cuál` : 'No se sabe de quién es este cobro: no hay factura abierta de ese importe' }, l.id)
  }

  // 6 · Gastos que ya se han clasificado antes con el mismo texto
  for (const l of libres().filter((x) => !x.entrada)) {
    const g = gastoAprendido(l, ctx.aprendido)
    if (g) dar({ tipo: 'gasto', linea: l, cuentaGasto: g, porque: 'Igual que la última vez' }, l.id)
    else dar({ tipo: 'revisar', linea: l, porque: 'Gasto nuevo: elige de qué es (y la próxima vez se hará solo)' }, l.id)
  }

  return acciones
}
