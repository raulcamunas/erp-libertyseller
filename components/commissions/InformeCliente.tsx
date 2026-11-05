'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import type { InformeCliente as Informe, TablaInforme } from '@/lib/comisiones-puente/informe-cliente'

/**
 * LA PÁGINA DEL INFORME DE COMISIÓN QUE SE LE PASA AL CLIENTE.
 *
 * Sigue el sistema de documentos de Liberty Seller: negro, naranja y crema, sin verdes ni rojos, Sora en los titulares
 * e Inter en el cuerpo. Es clara a propósito (se lee en el móvil del cliente y se guarda como PDF desde el navegador).
 *
 * No calcula nada: todo viene de `construirInforme`, que ya trae los textos formateados y las columnas que le tocan al
 * concepto de ese cliente.
 */

const NEGRO = '#0E0E0E'
const NARANJA = '#F26212'
const CREMA = '#EDE6DC'
const GRIS = '#5E5852'
const LINEA = '#E5E1DB'
const SOFT = '#F7F5F2'
const NARANJA_BG = '#FEF3EC'
const TITULAR = { fontFamily: 'var(--font-sora), var(--font-inter), system-ui, sans-serif' } as const

/** Cuántas líneas se pintan de entrada: un cliente con 1.200 referencias no necesita 1.200 filas al abrir */
const FILAS_INICIALES = 40

export function InformeCliente({ informe, tituloFuente }: { informe: Informe; tituloFuente: string }) {
  const [todas, setTodas] = useState(false)
  const [busca, setBusca] = useState('')

  const detalle = informe.detalle
  const filasVisibles = useMemo(() => {
    if (!detalle) return []
    const q = busca.trim().toLowerCase()
    const filtradas = q ? detalle.filas.filter((f) => f.some((c) => c.toLowerCase().includes(q))) : detalle.filas
    return filtradas
  }, [detalle, busca])
  const recorte = !todas && !busca.trim() ? filasVisibles.slice(0, FILAS_INICIALES) : filasVisibles

  function imprimir() {
    // Para el PDF se despliega todo el detalle y se espera a que se pinte
    setTodas(true)
    setTimeout(() => window.print(), 250)
  }

  return (
    <div className={`${tituloFuente} min-h-screen`} style={{ background: '#FFFFFF', color: NEGRO }}>
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-imprimir { display: none !important; }
          .evitar-corte { break-inside: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-6 sm:py-10">
        {/* ---------- Cabecera ---------- */}
        <header className="evitar-corte overflow-hidden rounded-[10px]" style={{ background: NEGRO }}>
          <div style={{ height: 4, background: NARANJA }} />
          <div className="px-5 pb-6 pt-5 sm:px-8 sm:pb-8">
            <div className="flex items-center justify-between gap-4">
              <Image src="/logos/logo.png" alt="Liberty Seller" width={140} height={36} className="h-auto w-[120px] object-contain sm:w-[140px]" priority />
              <button
                type="button"
                onClick={imprimir}
                className="no-imprimir rounded-[6px] px-3 py-[7px] text-[12px] font-medium"
                style={{ background: 'transparent', color: CREMA, border: `1px solid ${GRIS}` }}
              >
                Guardar como PDF
              </button>
            </div>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#B8AE9F' }}>
              Informe de comisión
            </p>
            <h1 className="mt-1 text-[28px] font-semibold leading-tight text-white sm:text-[36px]" style={TITULAR}>{informe.cliente}</h1>
            {informe.periodo && (
              <p className="mt-1 text-[16px] font-medium sm:text-[18px]" style={{ color: NARANJA }}>
                {informe.periodo}
              </p>
            )}
          </div>
        </header>

        {/* ---------- La cifra y sus cuatro apoyos ---------- */}
        <section className="evitar-corte mt-5 grid gap-3 sm:grid-cols-[1.15fr_2fr]">
          <div className="rounded-[10px] px-5 py-5 sm:px-6" style={{ background: NEGRO }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: '#B8AE9F' }}>
              {informe.principal.rotulo}
            </p>
            <p className="mt-2 text-[34px] font-semibold leading-none sm:text-[40px]" style={{ color: NARANJA, ...TITULAR }}>
              {informe.principal.valor}
            </p>
            <p className="mt-3 text-[13px] leading-snug" style={{ color: CREMA }}>
              {informe.principal.detalle}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {informe.cifras.map((c) => (
              <div key={c.rotulo} className="rounded-[10px] px-4 py-4" style={{ background: SOFT }}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: GRIS }}>
                  {c.rotulo}
                </p>
                <p className="mt-1.5 text-[20px] font-semibold leading-tight sm:text-[22px]" style={TITULAR}>{c.valor}</p>
                {c.nota && (
                  <p className="mt-1 text-[11.5px] leading-snug" style={{ color: GRIS }}>
                    {c.nota}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Cómo se calcula ---------- */}
        <Seccion numero="01" rotulo="Cálculo" titulo={informe.calculo.titulo}>
          <div className="evitar-corte rounded-[10px] border" style={{ borderColor: LINEA }}>
            {informe.calculo.pasos.map((p, i) => (
              <div
                key={`${p.texto}-${i}`}
                className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-[14px]"
                style={{
                  borderTop: i === 0 ? undefined : `1px solid ${p.tipo === 'resultado' ? NEGRO : LINEA}`,
                  background: p.tipo === 'resultado' ? NARANJA_BG : undefined,
                  fontWeight: p.tipo === 'resultado' ? 600 : 400,
                }}
              >
                <span style={{ color: p.tipo === 'resultado' ? NEGRO : GRIS }}>{p.texto}</span>
                <span className="whitespace-nowrap tabular-nums">{p.valor}</span>
              </div>
            ))}
          </div>
          {informe.calculo.nota && <p className="mt-3 text-[13px] leading-relaxed" style={{ color: GRIS }}>{informe.calculo.nota}</p>}
        </Seccion>

        {informe.lectura.length > 0 && (
          <div
            className="evitar-corte mt-6 rounded-[10px] px-5 py-4"
            style={{ background: NARANJA_BG, borderLeft: `4px solid ${NARANJA}` }}
          >
            <p className="text-[13px] font-semibold">Cómo leer este informe</p>
            <ul className="mt-1.5 space-y-1 text-[13px] leading-relaxed" style={{ color: GRIS }}>
              {informe.lectura.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}

        {informe.avisos.length > 0 && (
          <div className="evitar-corte mt-4 rounded-[10px] px-5 py-4" style={{ background: NEGRO }}>
            <p className="text-[13px] font-semibold" style={{ color: NARANJA }}>
              A tener en cuenta
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px] leading-relaxed" style={{ color: CREMA }}>
              {informe.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- Tablas de apoyo ---------- */}
        {informe.tablas.map((t, i) => (
          <Seccion key={t.titulo} numero={String(i + 2).padStart(2, '0')} rotulo="Desglose" titulo={t.titulo} subtitulo={t.subtitulo}>
            <Tabla tabla={t} filas={t.filas} />
          </Seccion>
        ))}

        {/* ---------- El detalle ---------- */}
        {detalle && (
          <Seccion
            numero={String(informe.tablas.length + 2).padStart(2, '0')}
            rotulo="Detalle"
            titulo={detalle.titulo}
            subtitulo={detalle.subtitulo}
          >
            <div className="no-imprimir mb-3">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por producto, ASIN, pedido o fecha…"
                className="w-full rounded-[6px] px-3 py-2 text-[13px] outline-none"
                style={{ border: `1px solid ${LINEA}`, background: '#fff' }}
              />
            </div>
            <Tabla tabla={detalle} filas={recorte} conTotal={!busca.trim()} />
            {!todas && !busca.trim() && filasVisibles.length > FILAS_INICIALES && (
              <div className="no-imprimir mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setTodas(true)}
                  className="rounded-[6px] px-4 py-2 text-[13px] font-medium"
                  style={{ border: `1px solid ${NEGRO}` }}
                >
                  Ver las {filasVisibles.length.toLocaleString('es-ES')} líneas
                </button>
              </div>
            )}
            {busca.trim() && (
              <p className="mt-2 text-[12px]" style={{ color: GRIS }}>
                {filasVisibles.length.toLocaleString('es-ES')} resultado{filasVisibles.length === 1 ? '' : 's'}
              </p>
            )}
          </Seccion>
        )}

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 pt-4 text-[11px]" style={{ borderTop: `1px solid ${LINEA}`, color: GRIS }}>
          <span className="font-semibold tracking-[0.12em]">LIBERTY SELLER</span>
          <span>libertyseller.com</span>
        </footer>
      </div>
    </div>
  )
}

function Seccion({ numero, rotulo, titulo, subtitulo, children }: { numero: string; rotulo: string; titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: GRIS }}>
        <span style={{ color: NARANJA }}>{numero}</span> · {rotulo}
      </p>
      <h2 className="mt-1 text-[20px] font-semibold sm:text-[22px]" style={TITULAR}>
        {titulo}
        {subtitulo && (
          <span className="ml-2 text-[13px] font-normal" style={{ color: GRIS }}>
            {subtitulo}
          </span>
        )}
      </h2>
      <div className="mb-4 mt-2" style={{ height: 3, width: 44, background: NARANJA }} />
      {children}
    </section>
  )
}

function Tabla({ tabla, filas, conTotal = true }: { tabla: TablaInforme; filas: string[][]; conTotal?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border" style={{ borderColor: LINEA }}>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr style={{ background: NEGRO, color: '#fff' }}>
            {tabla.columnas.map((c) => (
              <th
                key={c.id}
                className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${c.alinear === 'der' ? 'text-right' : 'text-left'}`}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} style={{ background: i % 2 === 1 ? SOFT : undefined, borderTop: `1px solid ${LINEA}` }} className="evitar-corte">
              {f.map((celda, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 ${tabla.columnas[j]?.alinear === 'der' ? 'whitespace-nowrap text-right tabular-nums' : 'text-left'}`}
                  style={{ color: j === 0 ? NEGRO : '#2E2C29' }}
                >
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {conTotal && tabla.total && (
          <tfoot>
            <tr style={{ background: NARANJA_BG, borderTop: `2px solid ${NEGRO}` }} className="font-semibold">
              {tabla.total.map((celda, j) => (
                <td key={j} className={`px-3 py-2.5 ${tabla.columnas[j]?.alinear === 'der' ? 'whitespace-nowrap text-right tabular-nums' : 'text-left'}`}>
                  {celda}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
