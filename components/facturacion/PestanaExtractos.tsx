'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Upload } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA, TARJETA, TEXTO, TIPO } from '@/lib/estilo/denso'
import type { CuentaDelPanel, CuentaQueFalta, Hecho, ResultadoDeImportar } from '@/lib/facturacion/extracto-servidor'
import { Aviso, dinero, fechaCorta, hoyISO, pedir } from './comun'
import { CabeceraTarjeta, Pastilla, Tarjeta, velo } from '@/components/contabilidad/ui'

type Cuenta = CuentaDelPanel & { ultimoExtracto?: string | null }

interface Respuesta {
  importadas: ResultadoDeImportar[]
  hechos: Hecho[]
  pendientes: number
  cuentas: Cuenta[]
}

const ETIQUETA: Record<Hecho['tipo'], string> = {
  cobro: 'Cobro',
  gasto: 'Gasto',
  cambio: 'Cambio de moneda',
  casar: 'Transferencia (llegada)',
  envio: 'Envío a cuenta propia',
  revisar: 'Por revisar',
}

const diasDesde = (iso: string | null | undefined) => (iso ? Math.round((Date.parse(hoyISO()) - Date.parse(iso)) / 86_400_000) : null)
const DIAS_AVISO = 8

/**
 * BANCOS Y EXTRACTOS.
 *
 * Cada semana se sube aquí el extracto de Payset (el «Accounting statement» en CSV, con todas las cuentas). El ERP lo mete en Zoho sin repetir lo que ya
 * estaba y casa solo lo seguro: cobros con su factura, comisiones, cambios de moneda, envíos a Wio. Lo de Wio llega a Zoho por su conexión directa y se
 * repasa igual. Lo que no sabe, lo deja en «Cobros y banco» con el porqué.
 */
export function PestanaExtractos({ onCambio, onIrACobros }: { onCambio: () => void; onIrACobros: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<'subir' | 'repasar' | null>(null)
  const [encima, setEncima] = useState(false)
  const [resultado, setResultado] = useState<Respuesta | null>(null)
  const [faltan, setFaltan] = useState<CuentaQueFalta[] | null>(null)
  const [monedas, setMonedas] = useState<Record<string, string>>({})
  const csv = useRef<string | null>(null)
  const fichero = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<{ cuentas: Cuenta[] }>('/api/facturacion/extracto')
      setCuentas(r.cuentas)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer las cuentas de Zoho')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function mandar(cuerpo: Record<string, unknown>, cual: 'subir' | 'repasar') {
    setOcupado(cual)
    setError(null)
    try {
      const r = await pedir<Respuesta & { faltan?: CuentaQueFalta[] }>('/api/facturacion/extracto', { metodo: 'POST', cuerpo })
      if (r.faltan) {
        setFaltan(r.faltan)
        return
      }
      setFaltan(null)
      setResultado(r)
      // Conserva la fecha del último extracto, que el POST no trae
      setCuentas((antes) => r.cuentas.map((c) => ({ ...c, ultimoExtracto: antes?.find((a) => a.id === c.id)?.ultimoExtracto ?? null })))
      if (cual === 'subir') void cargar()
      onCambio()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido terminar')
    } finally {
      setOcupado(null)
    }
  }

  async function elegirFichero(f: File | undefined) {
    if (!f) return
    csv.current = await f.text()
    setResultado(null)
    setFaltan(null)
    await mandar({ accion: 'subir', csv: csv.current }, 'subir')
    if (fichero.current) fichero.current.value = ''
  }

  const payset = (cuentas ?? []).filter((c) => c.esPayset)
  const atrasado = payset.map((c) => diasDesde(c.ultimoExtracto)).some((d) => d == null || d > DIAS_AVISO)

  return (
    <div className="flex max-w-[1200px] flex-col gap-2 pb-6">
      {error && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      )}
      {cuentas && atrasado && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Hace más de {DIAS_AVISO} días que no se sube el extracto de Payset. Descárgalo (Accounting statement · CSV · todas las cuentas) y súbelo aquí.
        </Aviso>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {!cuentas &&
          [0, 1, 2].map((i) => <div key={i} className="h-[118px] animate-pulse rounded-2xl bg-[var(--ls-sup)]" />)}
        {(cuentas ?? []).map((c) => {
          const d = diasDesde(c.ultimoExtracto)
          const viejo = c.esPayset && (d == null || d > DIAS_AVISO)
          const t = c.sinCasar > 0 || viejo ? 'ambar' : 'verde'
          return (
            <Tarjeta key={c.id} acento={c.esPayset ? 'violeta' : 'cian'} className="px-4 py-3.5">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg text-[11px] font-bold" style={{ background: velo(c.esPayset ? 'violeta' : 'cian', 18), color: COLOR_ESTADO[c.esPayset ? 'violeta' : 'cian'] }}>
                  {c.esPayset ? 'P' : 'W'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[var(--ls-t1)]">{c.esPayset ? c.nombre : `Wio ${c.moneda}`}</div>
                  <div className="text-[11px] text-[var(--ls-t3)]">
                    {c.moneda}
                    {c.ultimas4 ? ` · …${c.ultimas4}` : ''} · {c.esPayset ? 'se sube cada semana' : 'llega sola'}
                  </div>
                </div>
                <Pastilla tono={t}>{c.sinCasar > 0 ? `${c.sinCasar} sin casar` : viejo ? 'extracto viejo' : 'al día'}</Pastilla>
              </div>
              <div className="mt-3 text-[24px] font-semibold leading-none tabular-nums text-[var(--ls-t1)]">{dinero(c.saldo, c.moneda)}</div>
              <div className="mt-1.5 text-[11.5px] text-[var(--ls-t3)]">{c.esPayset ? (c.ultimoExtracto ? `Último extracto: ${fechaCorta(c.ultimoExtracto)} (hace ${d} d)` : 'Nunca se ha subido un extracto') : 'Saldo en Zoho'}</div>
            </Tarjeta>
          )
        })}
      </div>

      <Tarjeta>
        <CabeceraTarjeta
          icono={Upload}
          titulo="Subir el extracto de Payset"
          sub="Account statement → Accounting statement · todas las cuentas (EUR, AED, USD) · CSV"
          tonoIcono="naranja"
          accion={
            <button type="button" disabled={ocupado !== null} onClick={() => void mandar({ accion: 'repasar' }, 'repasar')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ls-linea)] px-3 text-[12px] font-medium text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${ocupado === 'repasar' ? 'animate-spin' : ''}`} />
              {ocupado === 'repasar' ? 'Repasando…' : 'Repasar sin casar (Wio incluido)'}
            </button>
          }
        />
        <div className="flex flex-col gap-3 px-4 pb-4">
          <input ref={fichero} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void elegirFichero(e.target.files?.[0])} />
          <button
            type="button"
            disabled={ocupado !== null}
            onClick={() => fichero.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setEncima(true)
            }}
            onDragLeave={() => setEncima(false)}
            onDrop={(e) => {
              e.preventDefault()
              setEncima(false)
              void elegirFichero(e.dataTransfer.files?.[0])
            }}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors disabled:opacity-60"
            style={{ borderColor: encima ? COLOR_ESTADO.naranja : 'var(--ls-linea2)', background: encima ? velo('naranja', 8) : 'var(--ls-sup2)' }}
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: velo('naranja', 15), color: COLOR_ESTADO.naranja }}>
              {ocupado === 'subir' ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            </span>
            <span className="text-[14px] font-semibold text-[var(--ls-t1)]">{ocupado === 'subir' ? 'Subiendo y casando en Zoho…' : 'Arrastra aquí el CSV de Payset o pulsa para elegirlo'}</span>
            <span className="max-w-[560px] text-[12px] text-[var(--ls-t3)]">Lo que ya está en Zoho no se vuelve a meter, así que da igual que se solape con el anterior. Lo seguro se casa solo; lo dudoso queda en «Cobros y banco».</span>
          </button>

          {faltan && (
            <div className="mt-1 flex flex-col gap-2 rounded-[6px] border border-[var(--ls-linea)] p-2">
              <p className={`${TIPO.s} ${TEXTO.t1}`}>El extracto trae {faltan.length === 1 ? 'una cuenta' : `${faltan.length} cuentas`} de Payset que Zoho aún no tiene. Dime su moneda y la doy de alta:</p>
              {faltan.map((f) => (
                <label key={f.cuenta} className="flex flex-wrap items-center gap-2">
                  <span className={`${TIPO.m} ${TEXTO.t2}`}>
                    Cuenta …{f.ultimas4} <span className={TEXTO.t3}>({f.filas} movimientos, p. ej. {f.ejemplo})</span>
                  </span>
                  <select value={monedas[f.cuenta] ?? ''} onChange={(e) => setMonedas((m) => ({ ...m, [f.cuenta]: e.target.value }))} className={`${CAMPO.input} w-[110px]`}>
                    <option value="">Moneda…</option>
                    <option value="EUR">EUR</option>
                    <option value="AED">AED</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
              ))}
              <div>
                <button
                  type="button"
                  disabled={ocupado !== null || faltan.some((f) => !monedas[f.cuenta])}
                  onClick={() => csv.current && void mandar({ accion: 'subir', csv: csv.current, crear: monedas }, 'subir')}
                  className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
                >
                  Dar de alta y seguir
                </button>
              </div>
            </div>
          )}
        </div>
      </Tarjeta>

      {resultado && <Resultado r={resultado} onIrACobros={onIrACobros} />}
    </div>
  )
}

function Resultado({ r, onIrACobros }: { r: Respuesta; onIrACobros: () => void }) {
  const cuenta = (t: Hecho['tipo']) => r.hechos.filter((h) => h.tipo === t && h.ok).length
  const errores = r.hechos.filter((h) => !h.ok)
  const revisar = r.hechos.filter((h) => h.tipo === 'revisar')
  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={`${TIPO.l} ${TEXTO.t1}`}>Lo que se ha hecho</h2>
      </header>
      <div className={`${TARJETA.cuerpo} flex flex-col gap-2`}>
        {r.importadas.length > 0 && (
          <ul className={`${TIPO.s} ${TEXTO.t2} flex flex-col gap-[2px]`}>
            {r.importadas.map((i) => {
              const c = r.cuentas.find((x) => x.id === i.cuentaId)
              const cuadra = c && i.saldoExtracto != null && Math.round(c.saldo * 100) === Math.round(i.saldoExtracto * 100) && c.sinCasar === 0
              return (
                <li key={i.cuenta}>
                  <strong className={TEXTO.t1}>{i.nombre}</strong>: {i.nuevas} movimientos nuevos{i.yaEstaban ? `, ${i.yaEstaban} ya estaban` : ''}.{' '}
                  {i.saldoExtracto != null && c && (
                    <span style={{ color: cuadra ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar }}>
                      {cuadra ? `Cuadra con el banco: ${dinero(c.saldo, c.moneda)}` : `Banco ${dinero(i.saldoExtracto, i.moneda)} · Zoho ${dinero(c.saldo, c.moneda)}${c.sinCasar ? ` (faltan ${c.sinCasar} por casar)` : ''}`}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className={`${TIPO.m} ${TEXTO.t2}`}>
          {cuenta('cobro')} cobros · {cuenta('gasto')} gastos y comisiones · {cuenta('cambio')} cambios de moneda · {cuenta('envio') + cuenta('casar')} transferencias
          {revisar.length > 0 && <span style={{ color: COLOR_ESTADO.ambar }}> · {revisar.length} por revisar</span>}
          {errores.length > 0 && <span style={{ color: COLOR_ESTADO.rojo }}> · {errores.length} con error</span>}
        </p>
        {r.hechos.length === 0 && (
          <p className={`${TIPO.s} ${TEXTO.t3} flex items-center gap-1`}>
            <CheckCircle2 className="h-[14px] w-[14px]" style={{ color: COLOR_ESTADO.verde }} /> No quedaba nada sin casar.
          </p>
        )}
        {r.hechos.length > 0 && (
          <div className="overflow-x-auto">
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={TABLA.cabecera}>Fecha</th>
                  <th className={TABLA.cabecera}>Cuenta</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Importe</th>
                  <th className={TABLA.cabecera}>Movimiento</th>
                  <th className={TABLA.cabecera}>Qué es</th>
                </tr>
              </thead>
              <tbody>
                {r.hechos.map((h, i) => (
                  <tr key={i} className={TABLA.fila}>
                    <td className={TABLA.celda}>{fechaCorta(h.fecha)}</td>
                    <td className={TABLA.celda}>{h.cuenta}</td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`} style={{ color: h.entrada ? COLOR_ESTADO.verde : undefined }}>
                      {h.entrada ? '+' : '−'}
                      {dinero(h.importe, h.moneda)}
                    </td>
                    <td className={`${TABLA.celda} max-w-[280px]`}>
                      <span className={TABLA.corta} title={h.texto}>
                        {h.texto}
                      </span>
                    </td>
                    <td className={`${TABLA.celda} whitespace-normal`} style={{ color: !h.ok ? COLOR_ESTADO.rojo : h.tipo === 'revisar' ? COLOR_ESTADO.ambar : undefined }}>
                      <strong>{ETIQUETA[h.tipo]}</strong> · {h.ok ? h.porque : h.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(revisar.length > 0 || errores.length > 0) && (
          <div>
            <button type="button" onClick={onIrACobros} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>
              Casar a mano lo que queda (Cobros y banco)
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
