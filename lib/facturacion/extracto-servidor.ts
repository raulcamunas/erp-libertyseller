/**
 * TESORERÍA · SUBIR EL EXTRACTO DE PAYSET Y CASAR LO QUE SE PUEDA. SOLO SERVIDOR. ESCRIBE EN ZOHO BOOKS.
 *
 *   1. `importarPayset`  mete en Zoho las filas del extracto que aún no están, cada una en su cuenta (se reconocen por las 4 últimas cifras,
 *                        que Zoho guarda como «xxxx7942»). La referencia de cada línea es el «TX-…» de Payset: subir dos extractos que se
 *                        solapan no duplica nada.
 *   2. `repasar`         lee TODAS las líneas sin casar de TODAS las cuentas (Payset y Wio, que llega sola por su conexión con Zoho), decide con
 *                        `decidir()` y ejecuta lo seguro. Lo demás se queda sin casar, con el porqué, y se hace a mano en «Cobros y banco».
 *
 * Lo que aprende sale del propio Zoho: quién pagó qué factura antes y en qué cuenta se puso cada gasto. No hay tabla propia.
 *
 *
 * ============ SIGNOS AL IMPORTAR (comprobado el 17 nov 2026) ============
 *
 * Al importar un extracto, Zoho entiende «credit» como dinero que ENTRA y «debit» como dinero que SALE (como lo dice el banco). Al LISTAR las líneas,
 * en cambio, enseña lo contrario: «debit» = entra. Con el signo al revés los cobros se apuntan como salidas.
 *
 * ============ EL LÍMITE DE TOKENS ============
 *
 * Zoho deja renovar el token unas pocas veces cada pocos minutos, y con la misma clave que usa todo el ERP. `zoho()` lo reutiliza; aquí no se pide nunca
 * uno aparte. Las escrituras van de una en una.
 */

import { tipoDeCambio, zoho, zohoTodo } from '@/lib/zoho/books'
import { decidir, descripcionParaZoho, nombreNormalizado, type Accion, type Aprendido, type CuentaDeBanco, type FacturaAbierta, type FilaPayset, type Linea, type PataPendiente } from './extracto'

interface BancoZoho {
  account_id: string
  account_name: string
  account_type: string
  account_number?: string
  currency_code: string
  currency_id: string
  balance: number
  uncategorized_transactions?: number
  is_active?: boolean
  bank_name?: string
}

interface LineaZoho {
  transaction_id: string
  date: string
  amount: number
  debit_or_credit: string
  description?: string
  payee?: string
  reference_number?: string
  transaction_type?: string
  status?: string
  customer_id?: string
  offset_account_name?: string
}

export interface CuentaDelPanel {
  id: string
  nombre: string
  moneda: string
  saldo: number
  sinCasar: number
  esPayset: boolean
  ultimas4: string | null
}

/** Todos los estados de una línea de banco en Zoho: para saber qué hay ya, se piden uno a uno */
const ESTADOS = ['uncategorized', 'categorized', 'matched', 'manually_added', 'excluded'] as const

const ultimas4 = (s: string | undefined | null) => (s ?? '').replace(/\D/g, '').slice(-4) || null
const esPaysetZoho = (b: BancoZoho) => /payset|openpayd/i.test(`${b.account_name} ${b.bank_name ?? ''}`)

export async function bancos(): Promise<{ crudos: BancoZoho[]; cuentas: CuentaDelPanel[] }> {
  const crudos = (await zohoTodo<BancoZoho>('bankaccounts', 'bankaccounts')).filter((b) => b.account_type === 'bank' && b.is_active !== false)
  return {
    crudos,
    cuentas: crudos.map((b) => ({
      id: b.account_id,
      nombre: b.account_name,
      moneda: b.currency_code,
      saldo: Number(b.balance ?? 0),
      sinCasar: Number(b.uncategorized_transactions ?? 0),
      esPayset: esPaysetZoho(b),
      ultimas4: ultimas4(b.account_number),
    })),
  }
}

// ======================================================================
//   1 · IMPORTAR
// ======================================================================

export interface CuentaQueFalta {
  cuenta: string
  ultimas4: string
  filas: number
  ejemplo: string
}

export interface ResultadoDeImportar {
  cuenta: string
  cuentaId: string
  nombre: string
  moneda: string
  nuevas: number
  yaEstaban: number
  saldoExtracto: number | null
}

/** Las cuentas del extracto que todavía no tienen pareja en Zoho */
export function cuentasQueFaltan(filas: readonly FilaPayset[], cuentas: readonly CuentaDelPanel[]): CuentaQueFalta[] {
  const por = new Map<string, FilaPayset[]>()
  for (const f of filas) por.set(f.cuenta, [...(por.get(f.cuenta) ?? []), f])
  const faltan: CuentaQueFalta[] = []
  for (const [cuenta, fs] of por) {
    const u4 = ultimas4(cuenta) ?? cuenta.slice(-4)
    if (!cuentas.some((c) => c.esPayset && c.ultimas4 === u4)) faltan.push({ cuenta, ultimas4: u4, filas: fs.length, ejemplo: `${fs[0].contraparte} · ${fs[0].importe.toFixed(2)}` })
  }
  return faltan
}

/** Da de alta en Zoho la cuenta de Payset de esa moneda (con el IBAN, del que Zoho guarda las 4 últimas cifras) */
export async function crearCuentaPayset(cuenta: string, moneda: string): Promise<string> {
  const monedas = await zoho<{ currencies?: { currency_id: string; currency_code: string }[] }>('settings/currencies')
  const m = monedas.currencies?.find((c) => c.currency_code === moneda)
  if (!m) throw new Error(`Zoho no tiene la moneda ${moneda} dada de alta. Añádela en Configuración → Monedas.`)
  const r = await zoho<{ bankaccount?: { account_id: string } }>('bankaccounts', {
    metodo: 'POST',
    cuerpo: { account_name: `Payset ${moneda}`, account_type: 'bank', account_number: cuenta, currency_id: m.currency_id, bank_name: 'OpenPayd Financial Services Malta Limited' },
  })
  if (!r.bankaccount?.account_id) throw new Error('Zoho no ha devuelto la cuenta creada.')
  return r.bankaccount.account_id
}

export async function importarPayset(filas: readonly FilaPayset[], cuentas: readonly CuentaDelPanel[], soloVer = false): Promise<ResultadoDeImportar[]> {
  const por = new Map<string, FilaPayset[]>()
  for (const f of filas) por.set(f.cuenta, [...(por.get(f.cuenta) ?? []), f])
  const out: ResultadoDeImportar[] = []
  for (const [cuenta, fs] of por) {
    const c = cuentas.find((x) => x.esPayset && x.ultimas4 === (ultimas4(cuenta) ?? cuenta.slice(-4)))
    if (!c) continue
    const desde = [...fs].sort((a, b) => a.fecha.localeCompare(b.fecha))[0].fecha
    // Lo que ya está en Zoho desde esa fecha, en cualquier estado
    // (sin .catch: si no se puede saber qué hay, mejor fallar que importar dos veces)
    const listas = await Promise.all(
      ESTADOS.map((status) => zohoTodo<LineaZoho>('banktransactions', 'banktransactions', { account_id: c.id, date_start: desde, status }))
    )
    // Ya está si coincide la referencia «TX-…»… o, como al casar un cobro Zoho la pierde, la fecha, el importe y el sentido (cada línea de Zoho sirve una vez)
    const existentes = listas.flat()
    const refs = new Set(existentes.map((l) => (l.reference_number ?? '').trim()).filter(Boolean))
    const libres = existentes.filter((l) => !refs.has((l.reference_number ?? '').trim()) || !(l.reference_number ?? '').trim())
    const usadas = new Set<string>()
    const nuevas = fs.filter((f) => {
      if (refs.has(f.ref)) return false
      const igual = libres.find((l) => !usadas.has(l.transaction_id) && l.date === f.fecha && Math.round(Number(l.amount) * 100) === Math.round(Math.abs(f.importe) * 100) && (l.debit_or_credit === 'debit') === f.importe > 0)
      if (igual) {
        usadas.add(igual.transaction_id)
        return false
      }
      return true
    })
    if (nuevas.length > 0 && !soloVer) {
      const fechas = nuevas.map((f) => f.fecha).sort()
      await zoho('bankstatements', {
        metodo: 'POST',
        cuerpo: {
          account_id: c.id,
          start_date: fechas[0],
          end_date: fechas[fechas.length - 1],
          transactions: nuevas.map((f) => ({
            transaction_id: f.ref,
            date: f.fecha,
            // Ver arriba: al importar, «credit» = entra
            debit_or_credit: f.importe > 0 ? 'credit' : 'debit',
            amount: Math.abs(f.importe),
            payee: f.contraparte.slice(0, 100),
            description: descripcionParaZoho(f),
            reference_number: f.ref,
          })),
        },
      })
    }
    const ultima = fs[fs.length - 1]
    out.push({ cuenta, cuentaId: c.id, nombre: c.nombre, moneda: c.moneda, nuevas: nuevas.length, yaEstaban: fs.length - nuevas.length, saldoExtracto: ultima.saldo })
  }
  return out
}

// ======================================================================
//   2 · REPASAR LO QUE ESTÁ SIN CASAR
// ======================================================================

export interface Hecho {
  tipo: Accion['tipo']
  fecha: string
  cuenta: string
  moneda: string
  importe: number
  entrada: boolean
  texto: string
  porque: string
  ok: boolean
  error?: string
}

interface FacturaZoho {
  invoice_id: string
  invoice_number: string
  customer_id: string
  customer_name: string
  currency_code: string
  balance: number
  date: string
}

/** Lo que Zoho admite en una descripción: sin flechas ni símbolos raros (si no, «Invalid value passed for Description») */
const limpio = (s: string) => s.replace(/[^\p{L}\p{N} .,:()/-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

export async function repasar(soloVer = false): Promise<{ hechos: Hecho[]; pendientes: number; aprendidos: number }> {
  const [{ crudos, cuentas }, plan, impagadas, parciales, org] = await Promise.all([
    bancos(),
    zohoTodo<{ account_id: string; account_name: string; account_type: string }>('chartofaccounts', 'chartofaccounts'),
    zohoTodo<FacturaZoho>('invoices', 'invoices', { status: 'unpaid' }),
    zohoTodo<FacturaZoho>('invoices', 'invoices', { status: 'partially_paid' }),
    zoho<{ organization?: { currency_code?: string } }>(`organizations/${process.env.ZOHO_ORGANIZATION_ID}`),
  ])
  const base = org.organization?.currency_code ?? 'AED'
  const comisiones = plan.find((a) => /cargos y tasas bancarias|bank fees and charges/i.test(a.account_name))?.account_id
  if (!comisiones) throw new Error('No encuentro en Zoho la cuenta «Cargos y tasas bancarias».')
  const idDeCuentaGasto = new Map(plan.map((a) => [a.account_name, a.account_id]))
  const deCuenta = new Map(crudos.map((b) => [b.account_id, b]))

  // Las líneas sin casar, lo aprendido (cobros y gastos ya clasificados) y las patas de transferencia que esperan
  const sinCasar: Linea[] = []
  const aprendido: Aprendido[] = []
  const patas: PataPendiente[] = []
  for (const c of cuentas) {
    const [libres, clasificadas, casadas, aMano] = await Promise.all(
      ['uncategorized', 'categorized', 'matched', 'manually_added'].map((status) =>
        c.sinCasar === 0 && status === 'uncategorized' ? Promise.resolve([] as LineaZoho[]) : zohoTodo<LineaZoho>('banktransactions', 'banktransactions', { account_id: c.id, status }).catch(() => [] as LineaZoho[])
      )
    )
    for (const l of libres) sinCasar.push({ id: l.transaction_id, cuentaId: c.id, moneda: c.moneda, fecha: l.date, importe: Number(l.amount), entrada: l.debit_or_credit === 'debit', payee: l.payee ?? '', concepto: l.description ?? '' })
    for (const l of [...clasificadas, ...casadas]) {
      const claves = [nombreNormalizado(l.payee ?? ''), nombreNormalizado(l.description ?? '')].filter(Boolean)
      if (l.transaction_type === 'customer_payment' && l.customer_id) for (const clave of claves) aprendido.push({ clave, clienteId: l.customer_id })
      const gasto = l.transaction_type === 'expense' && l.offset_account_name ? idDeCuentaGasto.get(l.offset_account_name) : undefined
      if (gasto) for (const clave of claves) aprendido.push({ clave, cuentaGasto: gasto })
    }
    for (const l of aMano) if (l.transaction_type === 'transfer_fund' && l.debit_or_credit === 'debit') patas.push({ id: l.transaction_id, cuentaId: c.id, fecha: l.date, importe: Number(l.amount) })
  }
  if (sinCasar.length === 0) return { hechos: [], pendientes: 0, aprendidos: aprendido.length }

  const vistas = new Set<string>()
  const facturas: FacturaAbierta[] = [...impagadas, ...parciales]
    .filter((f) => !vistas.has(f.invoice_id) && Boolean(vistas.add(f.invoice_id)))
    .map((f) => ({ id: f.invoice_id, numero: f.invoice_number, clienteId: f.customer_id, cliente: f.customer_name, moneda: f.currency_code, saldo: Number(f.balance), fecha: f.date }))

  const acciones = decidir(sinCasar, { cuentas: cuentas.map<CuentaDeBanco>((c) => ({ id: c.id, nombre: c.nombre, moneda: c.moneda, esPayset: c.esPayset })), facturas, aprendido, patas, cuentaComisiones: comisiones })

  const tipos = new Map<string, number>()
  const tipo = async (moneda: string, fecha: string) => {
    if (moneda === base) return 1
    const k = `${moneda}|${fecha}`
    if (!tipos.has(k)) {
      const id = crudos.find((b) => b.currency_code === moneda)?.currency_id
      if (!id) throw new Error(`No hay cuenta en ${moneda} para saber su tipo de cambio.`)
      tipos.set(k, await tipoDeCambio(id, fecha))
    }
    return tipos.get(k)!
  }
  const nombre = (id: string) => deCuenta.get(id)?.account_name ?? id
  const casar = (linea: Linea, transaccion: string) =>
    zoho(`banktransactions/uncategorized/${linea.id}/match`, { metodo: 'POST', query: { account_id: linea.cuentaId }, cuerpo: { transactions_to_be_matched: [{ transaction_id: transaccion, transaction_type: 'transfer_fund' }] } })

  const hechos: Hecho[] = []
  for (const a of acciones) {
    const l = a.tipo === 'cambio' ? a.sale : a.linea
    const fila: Hecho = { tipo: a.tipo, fecha: l.fecha, cuenta: nombre(l.cuentaId), moneda: l.moneda, importe: l.importe, entrada: l.entrada, texto: [l.payee, l.concepto].filter(Boolean).join(' · '), porque: a.porque, ok: true }
    if (a.tipo === 'revisar' || soloVer) {
      hechos.push(fila)
      continue
    }
    try {
      if (a.tipo === 'cobro') {
        const total = Math.round((a.linea.importe + a.comision) * 100) / 100
        await zoho(`banktransactions/uncategorized/${a.linea.id}/categorize/customerpayments`, {
          metodo: 'POST',
          cuerpo: { customer_id: a.factura.clienteId, payment_mode: 'banktransfer', amount: total, bank_charges: a.comision, date: a.linea.fecha, account_id: a.linea.cuentaId, exchange_rate: await tipo(a.linea.moneda, a.linea.fecha), invoices: [{ invoice_id: a.factura.id, amount_applied: total }] },
        })
      } else if (a.tipo === 'gasto') {
        await zoho(`banktransactions/uncategorized/${a.linea.id}/categorize/expenses`, {
          metodo: 'POST',
          cuerpo: { account_id: a.cuentaGasto, paid_through_account_id: a.linea.cuentaId, date: a.linea.fecha, amount: a.linea.importe, exchange_rate: await tipo(a.linea.moneda, a.linea.fecha), description: limpio(a.linea.concepto || a.linea.payee) },
        })
      } else if (a.tipo === 'cambio') {
        // El tipo de la transferencia es el de la moneda de SALIDA respecto a la base, deducido de lo que entró: así la otra pata sale con su importe real
        const entraEnBase = a.entra.importe * (await tipo(a.entra.moneda, a.entra.fecha))
        const r = await zoho<{ banktransaction?: { transaction_id: string } }>(`banktransactions/uncategorized/${a.sale.id}/categorize`, {
          metodo: 'POST',
          cuerpo: { transaction_type: 'transfer_fund', from_account_id: a.sale.cuentaId, to_account_id: a.entra.cuentaId, amount: a.sale.importe, exchange_rate: Math.round((entraEnBase / a.sale.importe) * 1e6) / 1e6, date: a.sale.fecha, description: limpio(`Cambio ${a.sale.moneda} a ${a.entra.moneda}`) },
        })
        const t = r.banktransaction?.transaction_id
        if (!t) throw new Error('Zoho no ha devuelto la transferencia')
        try {
          await casar(a.entra, t)
        } catch (e) {
          throw new Error(`La salida se ha apuntado como transferencia, pero la entrada de ${a.entra.importe.toFixed(2)} ${a.entra.moneda} no se ha podido casar: hazlo a mano en «Cobros y banco» (${e instanceof Error ? e.message : String(e)})`)
        }
      } else if (a.tipo === 'envio') {
        await zoho(`banktransactions/uncategorized/${a.linea.id}/categorize`, {
          metodo: 'POST',
          cuerpo: { transaction_type: 'transfer_fund', from_account_id: a.linea.cuentaId, to_account_id: a.destino.id, amount: a.linea.importe, exchange_rate: await tipo(a.linea.moneda, a.linea.fecha), date: a.linea.fecha, description: limpio(`Envio a ${a.destino.nombre}`) },
        })
      } else if (a.tipo === 'casar') {
        await casar(a.linea, a.pata.id)
      }
    } catch (e) {
      fila.ok = false
      fila.error = e instanceof Error ? e.message : String(e)
    }
    hechos.push(fila)
  }
  return { hechos, pendientes: hechos.filter((h) => h.tipo === 'revisar' || !h.ok).length, aprendidos: aprendido.length }
}

/** Cuándo se subió por última vez un extracto a cada cuenta de Payset (para avisar si pasa una semana) */
export async function ultimoExtracto(cuentaId: string): Promise<string | null> {
  try {
    const r = await zoho<{ statement?: { to_date?: string; from_date?: string } }>(`bankaccounts/${cuentaId}/statement/lastimported`)
    return r.statement?.to_date ?? r.statement?.from_date ?? null
  } catch {
    return null
  }
}
