'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Calculator, Globe, Info, Loader2, Package, Plus, Receipt, Settings, SlidersHorizontal, Wallet } from 'lucide-react'
import { PanelLateral } from '@/components/ui-ls'
import { marketplaceById } from '@/lib/types/amazon'
import { AJUSTES_POR_DEFECTO, normalizarAjustes, type AjustesCuenta } from '@/lib/ventas/ajustes'
import type { CuentaDelPanel } from '@/lib/ventas/panel-servidor'
import { Marco, TARJETA } from './TableroVentas'
import { Inicial } from './SelectorDeCuenta'
import { euros, fechaCorta } from './piezas'

/**
 * VENTAS · CONFIGURACIÓN (como «General → Cuentas» de Sellerboard, sin las conexiones de eBay, TikTok…): todas las cuentas del panel y, al pulsar
 * «Configuración» en una, sus ajustes por pestañas (IVA, FBM Pick & Pack, Lógica de cálculo, Otras). Solo lo que de verdad cambia las cuentas.
 */

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}
const enviar = <T,>(cuerpo: Record<string, unknown>) => pedir<T>('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
const nombre = (c: CuentaDelPanel) => c.cliente ?? c.nombre

export function ConfiguracionVentas() {
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [libres, setLibres] = useState<Array<{ id: string; nombre: string; cliente: string | null }>>([])
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<CuentaDelPanel | null>(null)
  const [anadir, setAnadir] = useState(false)
  const cargar = useCallback(() => {
    pedir<{ cuentas: CuentaDelPanel[]; libres: typeof libres }>('/api/ventas?que=cuentas')
      .then((r) => {
        setCuentas([...r.cuentas].sort((a, b) => nombre(a).localeCompare(nombre(b), 'es')))
        setLibres(r.libres ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(() => cargar(), [cargar])

  return (
    <Marco
      titulo="Configuración"
      subtitulo="Las cuentas del panel y cómo se calcula cada una: IVA, preparación de pedidos FBM, margen y flujo de caja"
      icono={Settings}
      acciones={
        libres.length > 0 && (
          <button type="button" onClick={() => setAnadir((x) => !x)} className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-[var(--ls-linea)] px-4 text-[12.5px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
            <Plus className="h-[14px] w-[14px]" /> Añadir cuenta
          </button>
        )
      }
    >
      {error && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F87171_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F87171]">{error}</p>}
      {anadir && (
        <div className={`${TARJETA} mb-4 p-4`}>
          <div className="mb-2 text-[12.5px] text-[var(--ls-t3)]">Cuentas de Amazon conectadas que aún no están en el panel (la lectura empieza sola en la próxima pasada):</div>
          <div className="flex flex-wrap gap-2">
            {libres.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={async () => {
                  await enviar({ accion: 'anadir', cuenta: l.id }).catch((e) => setError(String(e)))
                  setAnadir(false)
                  cargar()
                }}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] px-3 text-[12.5px] text-[var(--ls-t2)] hover:border-[#F26212] hover:text-[var(--ls-t1)]"
              >
                <Plus className="h-[13px] w-[13px]" /> {l.cliente ?? l.nombre}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`${TARJETA} overflow-hidden`}>
        {!cuentas ? (
          <div className="m-4 h-[240px] animate-pulse rounded-[14px] bg-[var(--ls-sup2)]" />
        ) : (
          cuentas.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex flex-col gap-3 border-b border-[var(--ls-linea)] px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Inicial texto={nombre(c)} emoji={c.emoji} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-[var(--ls-t1)]">{nombre(c)}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--ls-t4)]">
                    <Globe className="h-[12px] w-[12px]" />
                    {c.mercados.length ? c.mercados.map((m) => marketplaceById(m)?.countryCode ?? m).join(' · ') : 'Sin mercados'}
                    {c.nombre !== nombre(c) && <span>· {c.nombre}</span>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-[6px]">
                <Chip>{c.ivaPorPais ? 'IVA de cada país (OSS)' : `IVA ${c.iva} %`}</Chip>
                {!c.ajustes.ivaVentas && <Chip>Sin IVA en ventas</Chip>}
                {!c.ajustes.tarifasConIva && <Chip>Tarifas con IVA no recuperable</Chip>}
                {c.ajustes.ivaPublicidad && <Chip>IVA en publicidad</Chip>}
                {(c.ajustes.pickPaquete > 0 || c.ajustes.pickArticulo > 0) && <Chip>Pick & Pack</Chip>}
                {c.ajustes.margenSobreNeto && <Chip>Margen sobre netas</Chip>}
                {c.ajustes.flujoDesde && <Chip>Pagos desde {fechaCorta(c.ajustes.flujoDesde)}</Chip>}
              </div>
              <button type="button" onClick={() => setAbierta(c)} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[12.5px] text-[var(--ls-acc)] hover:bg-[var(--ls-sup2)]">
                <SlidersHorizontal className="h-[14px] w-[14px]" /> Configuración
              </button>
            </motion.div>
          ))
        )}
        {cuentas?.length === 0 && <p className="px-5 py-10 text-center text-[13px] text-[var(--ls-t4)]">Aún no hay cuentas en el panel.</p>}
      </div>

      <AjustesDeCuenta
        cuenta={abierta}
        onCerrar={() => setAbierta(null)}
        onGuardado={() => {
          setAbierta(null)
          cargar()
        }}
      />
    </Marco>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-[9px] py-[3px] text-[11px] text-[var(--ls-t3)]">{children}</span>
}

type Pestana = 'iva' | 'pick' | 'logica' | 'otras'
const PESTANAS: Array<[Pestana, string, typeof Receipt]> = [
  ['iva', 'IVA', Receipt],
  ['pick', 'FBM Pick & Pack', Package],
  ['logica', 'Lógica de cálculo', Calculator],
  ['otras', 'Otras', Wallet],
]

function AjustesDeCuenta({ cuenta, onCerrar, onGuardado }: { cuenta: CuentaDelPanel | null; onCerrar: () => void; onGuardado: () => void }) {
  const [pestana, setPestana] = useState<Pestana>('iva')
  const [a, setA] = useState<AjustesCuenta>(AJUSTES_POR_DEFECTO)
  const [iva, setIva] = useState('21')
  const [porPais, setPorPais] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!cuenta) return
    setA(normalizarAjustes(cuenta.ajustes))
    setIva(String(cuenta.iva).replace('.', ','))
    setPorPais(cuenta.ivaPorPais)
    setPestana('iva')
    setError(null)
  }, [cuenta])
  const cambiar = <K extends keyof AjustesCuenta>(k: K, v: AjustesCuenta[K]) => setA((x) => ({ ...x, [k]: v }))
  const num = (t: string) => {
    const x = t.replace(/\s|€/g, '')
    const n = Number(x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x)
    return Number.isFinite(n) ? n : NaN
  }

  const guardar = async () => {
    if (!cuenta) return
    const pct = num(iva)
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      setError('El IVA de la cuenta tiene que ir de 0 a 30.')
      setPestana('iva')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await enviar({ accion: 'ajustes', cuenta: cuenta.id, ajustes: a })
      if (pct !== cuenta.iva) await enviar({ accion: 'iva', cuenta: cuenta.id, iva: pct })
      if (porPais !== cuenta.ivaPorPais) await enviar({ accion: 'iva-pais', cuenta: cuenta.id, porPais })
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <PanelLateral
      abierto={Boolean(cuenta)}
      onCambio={(x) => !x && onCerrar()}
      titulo={cuenta ? `Ajustes · ${nombre(cuenta)}` : 'Ajustes'}
      descripcion="Cómo se calculan el beneficio y el flujo de caja de esta cuenta. Cambia el tablero, Productos y el flujo de caja al momento."
      icono={Settings}
      acento="marca"
      ancho={640}
      pie={
        <div className="flex items-center justify-end gap-2">
          {error && <span className="mr-auto text-[12px] text-[#F87171]">{error}</span>}
          <button type="button" onClick={onCerrar} className="h-11 rounded-[11px] border border-[var(--ls-linea)] px-4 text-[13px] text-[var(--ls-t2)]">
            Cancelar
          </button>
          <button type="button" disabled={guardando} onClick={guardar} className="inline-flex h-11 items-center gap-2 rounded-[11px] px-5 text-[13px] font-semibold text-[#141414] disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}>
            {guardando && <Loader2 className="h-[14px] w-[14px] animate-spin" />} Aplicar
          </button>
        </div>
      }
    >
      <div className="-mt-1 mb-4 flex gap-1 overflow-x-auto border-b border-[var(--ls-linea)]">
        {PESTANAS.map(([k, t, Icono]) => (
          <button key={k} type="button" onClick={() => setPestana(k)} className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-[9px] text-[12.5px] ${pestana === k ? 'border-[#F26212] text-[var(--ls-t1)]' : 'border-transparent text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
            <Icono className="h-[13px] w-[13px]" /> {t}
          </button>
        ))}
      </div>

      {pestana === 'iva' && (
        <div className="flex flex-col">
          <Seccion titulo="IVA sobre las ventas">
            <Fila etiqueta="IVA de la cuenta" ayuda="El que se quita a las ventas (y a las tarifas, si llevan IVA recuperable).">
              <div className="flex items-center gap-2">
                <input value={iva} onChange={(e) => setIva(e.target.value)} inputMode="decimal" className={`${CAMPO} w-[80px] text-right`} />
                <span className="text-[12.5px] text-[var(--ls-t3)]">%</span>
              </div>
            </Fila>
            <Fila etiqueta="Considerar para IVA" ayuda="Descontar el IVA de las ventas desde la fecha de inicio (antes, sin IVA).">
              <div className="flex items-center gap-3">
                <Casilla valor={a.ivaVentas} onCambio={(v) => cambiar('ivaVentas', v)} />
                <input type="date" disabled={!a.ivaVentas} value={a.ivaVentasDesde ?? ''} onChange={(e) => cambiar('ivaVentasDesde', e.target.value || null)} className={`${CAMPO} w-[160px]`} title="Fecha de inicio (vacío = siempre)" />
              </div>
            </Fila>
            <Fila etiqueta="Ventanilla única de la Unión (OSS)" ayuda="Cada venta lleva el IVA de su país (Francia 20 %, Alemania 19 %, Italia 22 %…).">
              <Casilla valor={porPais} onCambio={setPorPais} />
            </Fila>
          </Seccion>
          <Seccion titulo="IVA sobre las comisiones de Amazon">
            <Fila etiqueta="Las tarifas de Amazon incluyen el IVA y podré recuperarlo" ayuda="Las tarifas se cuentan sin su IVA desde la fecha de inicio. Apagado: se cuentan enteras.">
              <div className="flex items-center gap-3">
                <Casilla valor={a.tarifasConIva} onCambio={(v) => cambiar('tarifasConIva', v)} />
                <input type="date" disabled={!a.tarifasConIva} value={a.tarifasIvaDesde ?? ''} onChange={(e) => cambiar('tarifasIvaDesde', e.target.value || null)} className={`${CAMPO} w-[160px]`} title="Fecha de inicio (vacío = siempre)" />
              </div>
            </Fila>
          </Seccion>
          <Seccion titulo="IVA sobre los gastos de publicidad">
            <Fila etiqueta="Agregar IVA local a los costes de publicidad" ayuda={`La publicidad se cuenta con el ${iva || '21'} % de IVA encima (Amazon Ads factura sin IVA).`}>
              <Casilla valor={a.ivaPublicidad} onCambio={(v) => cambiar('ivaPublicidad', v)} />
            </Fila>
          </Seccion>
        </div>
      )}

      {pestana === 'pick' && (
        <div className="flex flex-col">
          <p className="mb-3 text-[12.5px] text-[var(--ls-t3)]">Lo que cuesta preparar cada pedido FBM (los que envía el cliente). Se resta como «FBM Pick &amp; Pack», aparte del coste de envío.</p>
          <Seccion titulo="Coste de preparación">
            <Fila etiqueta="Coste por paquete">
              <Dinero valor={a.pickPaquete} onCambio={(v) => cambiar('pickPaquete', v ?? 0)} />
            </Fila>
            <Fila etiqueta="Precio por artículo">
              <Dinero valor={a.pickArticulo} onCambio={(v) => cambiar('pickArticulo', v ?? 0)} />
            </Fila>
            <Fila etiqueta="Precio diferente para los X primeros artículos" ayuda="Ej.: el primer artículo de cada pedido a 0,80 € y los siguientes al precio de arriba.">
              <Casilla valor={a.pickPrimeros != null} onCambio={(v) => setA((x) => ({ ...x, pickPrimeros: v ? 1 : null, pickPrecioPrimeros: v ? (x.pickPrecioPrimeros ?? 0) : null }))} />
            </Fila>
            <Fila etiqueta="Número de artículos">
              <input disabled={a.pickPrimeros == null} value={a.pickPrimeros ?? ''} onChange={(e) => cambiar('pickPrimeros', Math.max(1, Math.round(Number(e.target.value) || 1)))} inputMode="numeric" className={`${CAMPO} w-[100px] text-right`} />
            </Fila>
            <Fila etiqueta="Precio por artículo (los primeros)">
              <Dinero valor={a.pickPrecioPrimeros} desactivado={a.pickPrimeros == null} onCambio={(v) => cambiar('pickPrecioPrimeros', v)} />
            </Fila>
          </Seccion>
          <Nota>
            Ejemplo con lo puesto: un pedido de 2 artículos cuesta{' '}
            <b className="text-[var(--ls-t1)]">
              {euros(a.pickPaquete + (a.pickPrimeros && a.pickPrecioPrimeros != null ? Math.min(2, a.pickPrimeros) * a.pickPrecioPrimeros + Math.max(0, 2 - a.pickPrimeros) * a.pickArticulo : 2 * a.pickArticulo))}
            </b>
            .
          </Nota>
        </div>
      )}

      {pestana === 'logica' && (
        <div className="flex flex-col">
          <Seccion titulo="Cómo se calcula">
            <Fila etiqueta="Utilizar las ventas netas para calcular el margen" ayuda="Margen = ganancia neta ÷ ventas sin IVA. Apagado: ÷ ventas con IVA (como hasta ahora).">
              <Casilla valor={a.margenSobreNeto} onCambio={(v) => cambiar('margenSobreNeto', v)} />
            </Fila>
            <Fila etiqueta="Ignorar órdenes multicanal" ayuda="Los envíos de Logística multicanal (pedidos de otras tiendas que sirve Amazon) nunca cuentan como ventas.">
              <span className="text-[12px] text-[var(--ls-t4)]">Siempre</span>
            </Fila>
            <Fila etiqueta="Tarifas de almacenamiento" ayuda="Van al mes en el que Amazon las cobra (como la opción por defecto de Sellerboard).">
              <span className="text-[12px] text-[var(--ls-t4)]">Mes en que se cobran</span>
            </Fila>
          </Seccion>
        </div>
      )}

      {pestana === 'otras' && (
        <div className="flex flex-col">
          <Seccion titulo="Flujo de caja">
            <Fila etiqueta="Considerar pagos de Amazon a partir de" ayuda="Los pagos anteriores no cuentan en el flujo de caja (vacío = todos los de los últimos 2 años).">
              <input type="date" value={a.flujoDesde ?? ''} onChange={(e) => cambiar('flujoDesde', e.target.value || null)} className={`${CAMPO} w-[160px]`} />
            </Fila>
          </Seccion>
          <Nota>Los datos se guardan 2 años, lo mismo que Amazon deja leer hacia atrás.</Nota>
        </div>
      )}
    </PanelLateral>
  )
}

const CAMPO = 'h-10 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[#F26212] disabled:opacity-40'

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">{titulo}</div>
      <div className="rounded-[14px] border border-[var(--ls-linea)]">{children}</div>
    </div>
  )
}

function Fila({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--ls-linea)] px-4 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-[6px] text-[13px] text-[var(--ls-t1)]">
          {etiqueta}
          {ayuda && (
            <span title={ayuda} className="text-[var(--ls-t4)]">
              <Info className="h-[13px] w-[13px]" />
            </span>
          )}
        </div>
        {ayuda && <div className="mt-[2px] text-[11.5px] leading-snug text-[var(--ls-t4)]">{ayuda}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Casilla({ valor, onCambio }: { valor: boolean; onCambio: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={valor} onClick={() => onCambio(!valor)} className={`relative h-[22px] w-[40px] rounded-full transition-colors ${valor ? 'bg-[#F26212]' : 'bg-[var(--ls-sup2)] ring-1 ring-[var(--ls-linea)]'}`}>
      <span className={`absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow transition-[left] ${valor ? 'left-[21px]' : 'left-[3px]'}`} />
    </button>
  )
}

/** Un importe en euros que deja escribir la coma (guarda el texto y pasa el número) */
function Dinero({ valor, onCambio, desactivado }: { valor: number | null; onCambio: (v: number | null) => void; desactivado?: boolean }) {
  const aTexto = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))
  const [texto, setTexto] = useState(aTexto(valor))
  const [foco, setFoco] = useState(false)
  useEffect(() => {
    if (!foco) setTexto(aTexto(valor))
  }, [valor, foco])
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12.5px] text-[var(--ls-t3)]">€</span>
      <input
        disabled={desactivado}
        value={texto}
        inputMode="decimal"
        placeholder="0,00"
        onFocus={() => setFoco(true)}
        onBlur={() => setFoco(false)}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '')
          setTexto(t)
          const limpio = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
          const n = limpio === '' ? null : Number(limpio)
          onCambio(n == null || Number.isFinite(n) ? n : null)
        }}
        className={`${CAMPO} w-[120px] text-right`}
      />
    </div>
  )
}

function Nota({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 rounded-[12px] bg-[var(--ls-sup2)] px-4 py-3 text-[12px] leading-relaxed text-[var(--ls-t3)]">{children}</p>
}
