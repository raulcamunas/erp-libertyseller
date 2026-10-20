'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Copy, GripVertical, Minus, Plus, Search, Trash2, TriangleAlert, X } from 'lucide-react'
import { maximoEnCaja, type CampoDeMedida } from '@/lib/fba/encaje-operaciones'
import { KG_DE_CARGA_PESADA, cajaCompleta, leerMedida, unidadesDeCaja, type CajaEnEdicion, type LineaParaEncajar, type ResumenDeEncaje } from '@/lib/fba/encaje-resumen'
import { FUENTE_TITULO, cx, medidaATexto, n0 } from './marca'

/**
 * UNA CAJA: SUS MEDIDAS, SU PESO Y LO QUE LLEVA DENTRO.
 *
 * Es lo que el cliente tiene delante mientras encaja, así que está pensada para hacerlo con una mano
 * en la mercancía: las medidas se escriben con coma o con punto, cada línea tiene su contador con
 * «−» y «+», y las referencias se meten de tres formas —el selector de abajo, el «+» de la lista de la
 * izquierda o arrastrándolas encima de la caja—.
 *
 * La caja avisa de lo que le falta (medidas, peso, estar vacía) pero no riñe: mientras se encaja es
 * normal tenerla a medias. Lo que la bloquea de verdad es «He terminado», y eso lo dice la barra de arriba.
 */

export function TarjetaCaja({
  caja,
  lineas,
  cajas,
  resumen,
  editable,
  activa,
  arrastrando,
  puedeQuitar,
  onActivar,
  onMedida,
  onUnidades,
  onAnadirReferencia,
  onMeterPendientes,
  onQuitar,
  onNuevaIgual,
  onSoltar,
}: {
  caja: CajaEnEdicion
  lineas: LineaParaEncajar[]
  cajas: CajaEnEdicion[]
  resumen: ResumenDeEncaje
  editable: boolean
  activa: boolean
  /** Algo se está arrastrando: las cajas enseñan dónde se puede soltar */
  arrastrando: boolean
  puedeQuitar: boolean
  onActivar: () => void
  onMedida: (campo: CampoDeMedida, valor: number | null) => void
  onUnidades: (sku: string, unidades: number) => void
  onAnadirReferencia: (sku: string) => void
  onMeterPendientes: () => void
  onQuitar: () => void
  onNuevaIgual: () => void
  /** Lo que se ha soltado encima: «ref:SKU» desde la lista o «item:SKU:CAJA» desde otra caja */
  onSoltar: (dato: string) => void
}) {
  const [eligiendo, setEligiendo] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  const unidades = unidadesDeCaja(caja)
  const vacia = unidades === 0
  const completa = cajaCompleta(caja)
  const pesada = (caja.pesoKg ?? 0) > KG_DE_CARGA_PESADA
  // Mientras la caja está vacía no se riñe por sus medidas: primero lo que lleva dentro
  const faltaMedir = !vacia && !completa
  const pendientesEnTotal = resumen.pendientes

  const lineaPorSku = useMemo(() => new Map(lineas.map((l) => [l.sku, l])), [lineas])

  return (
    <section
      onClick={onActivar}
      onDragOver={(e) => {
        if (!editable) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!sobre) setSobre(true)
      }}
      onDragLeave={(e) => {
        // Salir de un hijo no es salir de la caja
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setSobre(false)
        if (editable) onSoltar(e.dataTransfer.getData('text/plain'))
      }}
      className={cx(
        'relative rounded-2xl border bg-[#FFFFFF] transition',
        sobre ? 'border-[#F26212] bg-[#FFF8F3] shadow-[0_0_0_4px_rgba(242,98,18,0.16)]' : activa ? 'border-[#F26212] shadow-[0_0_0_3px_rgba(242,98,18,0.10)]' : 'border-[#E5E1DB]',
        arrastrando && !sobre && editable && 'border-dashed border-[#F26212]/50'
      )}
      aria-label={`Caja ${caja.numero}`}
    >
      {sobre && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-[#FFF8F3]/85 text-[14px] font-semibold text-[#F26212]">
          Suéltala para meterla en la caja {caja.numero}
        </div>
      )}

      {/* ---------- la cabecera de la caja ---------- */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#FBEFE8] text-[#F26212]">
          <Box className="h-[18px] w-[18px]" />
        </span>
        <h3 className="text-[17px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          Caja {caja.numero}
        </h3>
        <span className="text-[12.5px] text-[#5E5852]">
          <b className="font-semibold text-[#141414] tabular-nums">{n0(unidades)}</b> unidad{unidades === 1 ? '' : 'es'}
        </span>
        {vacia && editable && <Etiqueta tono="ambar">Vacía</Etiqueta>}
        {faltaMedir && <Etiqueta tono="ambar">Falta medirla o pesarla</Etiqueta>}
        {pesada && (
          <Etiqueta tono="ambar" titulo={`Más de ${KG_DE_CARGA_PESADA} kg: Amazon la trata como carga pesada y hay que etiquetarla como tal`}>
            Carga pesada
          </Etiqueta>
        )}

        {editable && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onNuevaIgual()
              }}
              title="Añadir otra caja con las mismas medidas"
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-[#5E5852] transition hover:bg-[#F7F5F2] hover:text-[#141414]"
            >
              <Copy className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Otra igual</span>
            </button>
            {puedeQuitar &&
              (confirmando ? (
                <span className="flex items-center gap-2 rounded-lg bg-[#FBE3E0] px-2.5 py-1 text-[12px]" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[#141414]">¿Quitar{unidades > 0 ? ` (vuelven ${n0(unidades)} a «por encajar»)` : ''}?</span>
                  <button type="button" onClick={onQuitar} className="font-semibold text-[#C23B3B] hover:underline">
                    Sí
                  </button>
                  <button type="button" onClick={() => setConfirmando(false)} className="text-[#5E5852] hover:text-[#141414]">
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (unidades === 0) onQuitar()
                    else setConfirmando(true)
                  }}
                  title="Quitar esta caja"
                  aria-label={`Quitar la caja ${caja.numero}`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-[#8C857C] transition hover:bg-[#FBE3E0] hover:text-[#C23B3B]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ))}
          </div>
        )}
      </header>

      {/* ---------- medidas y peso ---------- */}
      <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
        <CampoMedida etiqueta="Largo" unidad="cm" valor={caja.largoCm} editable={editable} falta={faltaMedir && caja.largoCm === null} onCambio={(v) => onMedida('largoCm', v)} />
        <CampoMedida etiqueta="Ancho" unidad="cm" valor={caja.anchoCm} editable={editable} falta={faltaMedir && caja.anchoCm === null} onCambio={(v) => onMedida('anchoCm', v)} />
        <CampoMedida etiqueta="Alto" unidad="cm" valor={caja.altoCm} editable={editable} falta={faltaMedir && caja.altoCm === null} onCambio={(v) => onMedida('altoCm', v)} />
        <CampoMedida etiqueta="Peso" unidad="kg" valor={caja.pesoKg} editable={editable} falta={faltaMedir && caja.pesoKg === null} onCambio={(v) => onMedida('pesoKg', v)} />
      </div>

      {/* ---------- lo que lleva dentro ---------- */}
      <ul className="border-t border-[#EFEBE5]">
        {caja.contenido.map((x) => {
          const l = lineaPorSku.get(x.sku)
          return (
            <li
              key={x.sku}
              draggable={editable}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', `item:${x.sku}:${caja.numero}`)
                e.dataTransfer.effectAllowed = 'move'
              }}
              className="flex items-center gap-2.5 border-b border-[#EFEBE5] px-3 py-2 last:border-b-0"
            >
              <GripVertical className={cx('h-4 w-4 shrink-0 text-[#B8AE9F]', editable ? 'cursor-grab' : 'opacity-0')} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-[#141414]">{x.sku}</span>
                  {l?.variante && <span className="text-[11.5px] text-[#5E5852]">{l.variante}</span>}
                </div>
                {l?.nombre && (
                  <div className="truncate text-[11.5px] text-[#8C857C]" title={l.nombre}>
                    {l.nombre}
                  </div>
                )}
              </div>
              <Contador valor={x.unidades} maximo={maximoEnCaja(lineas, cajas, caja.numero, x.sku)} editable={editable} etiqueta={x.sku} onCambio={(n) => onUnidades(x.sku, n)} />
              {editable && (
                <button
                  type="button"
                  onClick={() => onUnidades(x.sku, 0)}
                  title="Sacarla de esta caja"
                  aria-label={`Sacar ${x.sku} de la caja ${caja.numero}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#8C857C] transition hover:bg-[#F7F5F2] hover:text-[#C23B3B]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          )
        })}
        {vacia && (
          <li className="px-4 py-5 text-center text-[13px] text-[#8C857C]">
            {editable ? 'Esta caja está vacía. Añade referencias con el botón de abajo, con el «+» de la lista o arrastrándolas aquí.' : 'Esta caja está vacía.'}
          </li>
        )}
      </ul>

      {/* ---------- añadir ---------- */}
      {editable && (
        <footer className="relative flex flex-wrap items-center gap-2 border-t border-[#EFEBE5] px-4 py-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setEligiendo((v) => !v)
            }}
            disabled={pendientesEnTotal === 0}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#141414] px-3.5 text-[13px] font-medium text-[#FFFFFF] transition hover:bg-[#F26212] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Añadir referencia
          </button>
          {pendientesEnTotal > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onMeterPendientes()
              }}
              title="Meter en esta caja todo lo que todavía no está en ninguna"
              className="h-9 rounded-lg px-3 text-[13px] text-[#5E5852] transition hover:bg-[#F7F5F2] hover:text-[#141414]"
            >
              Meter todo lo que falta ({n0(pendientesEnTotal)})
            </button>
          )}
          {pendientesEnTotal === 0 && <span className="text-[12.5px] text-[#2F9657]">No queda nada por encajar</span>}

          {eligiendo && (
            <SelectorDeReferencia
              lineas={lineas}
              resumen={resumen}
              onElegir={(sku) => {
                onAnadirReferencia(sku)
                setEligiendo(false)
              }}
              onCerrar={() => setEligiendo(false)}
            />
          )}
        </footer>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Etiqueta({ tono, titulo, children }: { tono: 'ambar'; titulo?: string; children: React.ReactNode }) {
  return (
    <span title={titulo} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium', tono === 'ambar' && 'bg-[#FBF0D2] text-[#9A7410]')}>
      <TriangleAlert className="h-3 w-3" />
      {children}
    </span>
  )
}

/** Medida o peso: se escribe con coma o con punto y no pierde lo que se está tecleando («8,» no se borra) */
function CampoMedida({ etiqueta, unidad, valor, editable, falta, onCambio }: { etiqueta: string; unidad: string; valor: number | null; editable: boolean; falta: boolean; onCambio: (v: number | null) => void }) {
  const [texto, setTexto] = useState(medidaATexto(valor))
  // Si el valor cambia por fuera (una caja copiada, una recarga) y no coincide con lo escrito, se pone el de fuera
  useEffect(() => {
    if (leerMedida(texto) !== valor) setTexto(medidaATexto(valor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8C857C]">{etiqueta}</span>
      <span
        className={cx(
          'flex items-center rounded-lg border bg-[#FFFFFF] px-2.5 transition focus-within:border-[#F26212] focus-within:shadow-[0_0_0_3px_rgba(242,98,18,0.14)]',
          falta ? 'border-[#E0B43A] bg-[#FFFBEF]' : 'border-[#E5E1DB]'
        )}
      >
        <input
          inputMode="decimal"
          disabled={!editable}
          value={texto}
          placeholder="0"
          onChange={(e) => {
            setTexto(e.target.value)
            onCambio(leerMedida(e.target.value))
          }}
          onBlur={() => setTexto(medidaATexto(valor))}
          aria-label={`${etiqueta} en ${unidad}`}
          className="h-10 w-full min-w-0 bg-transparent text-[15px] tabular-nums text-[#141414] outline-none placeholder:text-[#B8AE9F] disabled:opacity-60"
        />
        <span className="ml-1 shrink-0 text-[12px] text-[#8C857C]">{unidad}</span>
      </span>
    </label>
  )
}

/** Cuántas unidades de una referencia hay en la caja: «−», el número que se puede teclear y «+» */
function Contador({ valor, maximo, editable, etiqueta, onCambio }: { valor: number; maximo: number; editable: boolean; etiqueta: string; onCambio: (n: number) => void }) {
  const [texto, setTexto] = useState(String(valor))
  useEffect(() => {
    if (texto !== '' && Number(texto) !== valor) setTexto(String(valor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  if (!editable) return <span className="w-12 text-right text-[14px] font-semibold tabular-nums text-[#141414]">{n0(valor)}</span>
  return (
    <div className="flex shrink-0 items-center rounded-lg border border-[#E5E1DB] bg-[#FFFFFF]">
      <button
        type="button"
        disabled={valor <= 1}
        onClick={() => onCambio(valor - 1)}
        aria-label={`Una unidad menos de ${etiqueta}`}
        className="grid h-9 w-9 place-items-center text-[#5E5852] transition hover:text-[#F26212] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        inputMode="numeric"
        value={texto}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, '')
          setTexto(t)
          // Vaciar el campo para teclear otro número NO quita la línea: solo cuenta lo que sea 1 o más
          if (t !== '' && Number(t) >= 1) onCambio(Number(t))
        }}
        onBlur={() => {
          if (texto === '0') onCambio(0)
          else setTexto(String(valor))
        }}
        aria-label={`Unidades de ${etiqueta} en esta caja`}
        className="h-9 w-12 bg-transparent text-center text-[14px] font-semibold tabular-nums text-[#141414] outline-none"
      />
      <button
        type="button"
        disabled={valor >= maximo}
        onClick={() => onCambio(valor + 1)}
        aria-label={`Una unidad más de ${etiqueta}`}
        title={valor >= maximo ? 'No quedan más de esta referencia' : undefined}
        className="grid h-9 w-9 place-items-center text-[#5E5852] transition hover:text-[#F26212] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}

/** La lista desplegable para meter una referencia: solo salen las que todavía tienen unidades por encajar */
function SelectorDeReferencia({ lineas, resumen, onElegir, onCerrar }: { lineas: LineaParaEncajar[]; resumen: ResumenDeEncaje; onElegir: (sku: string) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('')
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) onCerrar()
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [onCerrar])

  const t = q.trim().toLowerCase()
  const opciones = lineas.filter((l) => resumen.porSku[l.sku].restantes > 0 && (!t || l.sku.toLowerCase().includes(t) || (l.nombre ?? '').toLowerCase().includes(t) || (l.variante ?? '').toLowerCase().includes(t)))

  return (
    <div ref={caja} onClick={(e) => e.stopPropagation()} className="absolute left-3 right-3 top-full z-20 mt-1 rounded-xl border border-[#E5E1DB] bg-[#FFFFFF] shadow-[0_16px_40px_-14px_rgba(20,20,20,0.4)] sm:right-auto sm:w-[420px]">
      <label className="flex items-center gap-2 border-b border-[#EFEBE5] px-3">
        <Search className="h-4 w-4 shrink-0 text-[#8C857C]" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, nombre o talla" aria-label="Buscar la referencia" className="h-10 w-full bg-transparent text-[13.5px] text-[#141414] outline-none placeholder:text-[#B8AE9F]" />
      </label>
      <ul className="max-h-[260px] overflow-y-auto py-1">
        {opciones.map((l) => {
          const falta = resumen.porSku[l.sku].restantes
          return (
            <li key={l.sku}>
              <button type="button" onClick={() => onElegir(l.sku)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[#FBEFE8]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold text-[#141414]">{l.sku}</span>
                    {l.variante && <span className="text-[11.5px] text-[#5E5852]">{l.variante}</span>}
                  </div>
                  {l.nombre && <div className="truncate text-[11.5px] text-[#8C857C]">{l.nombre}</div>}
                </div>
                <span className="shrink-0 rounded-full bg-[#FBEFE8] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[#F26212]">faltan {n0(falta)}</span>
              </button>
            </li>
          )
        })}
        {opciones.length === 0 && <li className="px-3 py-5 text-center text-[13px] text-[#8C857C]">{t ? 'Ninguna coincide.' : 'No queda nada por encajar.'}</li>}
      </ul>
    </div>
  )
}
