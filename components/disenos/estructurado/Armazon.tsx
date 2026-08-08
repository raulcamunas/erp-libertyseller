'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Bell, Building2, Check, ChevronDown, Moon, Search, Sun, Rows3 } from 'lucide-react'
import { CSS } from './estilos'
import { CUENTAS, type Cuenta } from './datos'
import { ESPACIOS, MODULOS, ORDEN_GRUPOS, type EspacioId } from './navegacion'
import { ESTADO_CONEXION, ESTADO_EJECUCION } from './piezas'
import type { Densidad, Tema } from './tokens'

/**
 * EL ARMAZÓN. Aquí es donde vive la idea entera de esta propuesta.
 *
 * Tres piezas, y cada una resuelve un problema medido:
 *
 *   BARRA SUPERIOR (48 px)  — El ERP no tiene cabecera: hoy son dos iconos flotando
 *     en `position: fixed` sobre el contenido y cada pantalla se pone su propio
 *     título de 36 px, que cuesta entre 76 y 79 px de alto EN CADA PANTALLA. Aquí
 *     esos 79 px se pagan una vez, arriba, y a cambio traen tres cosas que hoy no
 *     hay en ningún sitio: sobre qué cuenta trabajas, dónde estás y cómo salir.
 *
 *   CARRIL (52 px)          — Nivel 1: los tres espacios. Siempre visibles, siempre
 *     en el mismo sitio, tres destinos en 132 px de alto.
 *
 *   NAVEGACIÓN (232 px)     — Nivel 2: solo los módulos del espacio en el que estás.
 *     Como mucho once. Hoy son dieciocho en una lista de 1.049 px que scrollea sola
 *     por debajo de esa altura de ventana.
 *
 * Y el SELECTOR DE CUENTA, que es la propuesta en sí: permanente, en la esquina
 * superior izquierda, con el nombre y el mercado siempre a la vista. Cambiar de
 * cuenta no te saca de donde estás: si estabas en el catálogo, sigues en el
 * catálogo. Cuando el espacio no es de cliente, el selector se APAGA a la vista —
 * gris, sin naranja, con la palabra «interno»— porque es la forma más barata de
 * decir «esto no es de ningún cliente, no te confundas».
 */

export interface EstadoArmazon {
  espacio: EspacioId
  modulo: string
  cuenta: Cuenta
  tema: Tema
  densidad: Densidad
  tinteFila: boolean
}

interface Props {
  estado: EstadoArmazon
  set: (parcial: Partial<EstadoArmazon>) => void
  children: React.ReactNode
  /** Alto del lienzo. 1080 es el monitor de sobremesa a pantalla completa */
  alto: number
}

export function Armazon({ estado, set, children, alto }: Props) {
  const espacio = ESPACIOS.find((e) => e.id === estado.espacio)!
  const modulos = MODULOS[estado.espacio]
  const modulo = modulos.find((m) => m.id === estado.modulo) ?? modulos[0]

  return (
    <div
      className="ctx-root"
      data-ctx-tema={estado.tema}
      data-ctx-densidad={estado.densidad}
      data-ctx-tinte={estado.tinteFila ? 'si' : 'no'}
      style={{ height: alto }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="ctx-app">
        {/* ---------------- BARRA SUPERIOR ---------------- */}
        <header className="ctx-barra">
          <div className="ctx-marca-hueco">
            <span className="ctx-logo" aria-label="Liberty Seller Hub">
              LS
            </span>
          </div>

          <SelectorDeCuenta estado={estado} set={set} />

          <nav className="ctx-migas" aria-label="Dónde estás">
            <span className="ctx-miga-sep" aria-hidden>
              /
            </span>
            <button
              type="button"
              className="ctx-miga ctx-t"
              onClick={() => set({ espacio: estado.espacio, modulo: MODULOS[estado.espacio][0].id })}
            >
              {espacio.nombre}
            </button>
            <span className="ctx-miga-sep" aria-hidden>
              /
            </span>
            <span className="ctx-miga" data-ctx-fin="true">
              {modulo.nombre}
            </span>
          </nav>

          <div className="ctx-barra-acciones">
            <div
              className="ctx-fila-flex ctx-t"
              style={{
                height: 28,
                width: 190,
                padding: '0 8px',
                gap: 6,
                border: '1px solid var(--ctx-line-2)',
                borderRadius: 'var(--ctx-r-control)',
                color: 'var(--ctx-fg-3)',
              }}
            >
              <Search size={13} aria-hidden />
              <span style={{ fontSize: 12 }}>Buscar</span>
              <span
                className="ctx-num"
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: 'var(--ctx-surface-3)',
                  color: 'var(--ctx-fg-3)',
                }}
              >
                ⌘K
              </span>
            </div>

            <div className="ctx-sep" aria-hidden />

            <button
              type="button"
              className="ctx-btn ctx-btn--fino ctx-t"
              onClick={() =>
                set({
                  densidad:
                    estado.densidad === 'compacta' ? 'normal' : estado.densidad === 'normal' ? 'comoda' : 'compacta',
                })
              }
              title="Alto de fila de las tablas"
            >
              <Rows3 size={13} aria-hidden />
              {estado.densidad === 'compacta' ? '24 px' : estado.densidad === 'normal' ? '28 px' : '32 px'}
            </button>

            <button
              type="button"
              className="ctx-btn ctx-btn--icono ctx-btn--fino ctx-t"
              style={{ width: 24 }}
              onClick={() => set({ tema: estado.tema === 'claro' ? 'oscuro' : 'claro' })}
              title={estado.tema === 'claro' ? 'Pasar a oscuro' : 'Pasar a claro'}
            >
              {estado.tema === 'claro' ? <Moon size={13} aria-hidden /> : <Sun size={13} aria-hidden />}
            </button>

            <button type="button" className="ctx-btn ctx-btn--icono ctx-btn--fino ctx-t" style={{ width: 24 }} title="Avisos">
              <Bell size={13} aria-hidden />
            </button>

            <span
              className="ctx-fila-flex"
              style={{
                height: 24,
                paddingLeft: 2,
                paddingRight: 8,
                gap: 6,
                borderRadius: 12,
                background: 'var(--ctx-surface-2)',
                boxShadow: 'inset 0 0 0 1px var(--ctx-line)',
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  background: 'var(--ctx-fg-2)',
                  color: 'var(--ctx-surface)',
                  fontSize: 9,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                RC
              </span>
              <span style={{ fontSize: 11, color: 'var(--ctx-fg-2)', fontWeight: 500 }}>Raúl</span>
            </span>
          </div>
        </header>

        {/* ---------------- CARRIL: los tres espacios ---------------- */}
        <nav className="ctx-carril" aria-label="Espacios">
          {ESPACIOS.map((e) => {
            const Icono = e.icono
            const activo = e.id === estado.espacio
            return (
              <button
                key={e.id}
                type="button"
                className="ctx-espacio ctx-t"
                data-ctx-activo={activo ? 'true' : 'false'}
                aria-current={activo ? 'page' : undefined}
                title={e.descripcion}
                onClick={() => set({ espacio: e.id, modulo: MODULOS[e.id][0].id })}
              >
                <Icono size={16} strokeWidth={2} aria-hidden />
                <span className="ctx-espacio-txt">{e.corto}</span>
              </button>
            )
          })}
        </nav>

        {/* ---------------- NAVEGACIÓN: los módulos del espacio ---------------- */}
        <nav className="ctx-nav" aria-label={espacio.nombre}>
          <div className="ctx-nav-cabecera">
            <div className="ctx-lg">{espacio.nombre}</div>
            <div className="ctx-sm" style={{ marginTop: 2 }}>
              {espacio.descripcion}
            </div>
          </div>

          {/* Cuando el espacio es de cliente, la cuenta se repite aquí abajo con su
              estado operativo. Es redundante a propósito: el error que se quiere
              hacer imposible es teclear un precio creyendo que estás en otra tienda. */}
          {espacio.conCuenta && <TarjetaCuenta cuenta={estado.cuenta} />}

          <div className="ctx-nav-lista">
            {ORDEN_GRUPOS[estado.espacio].map((grupo) => (
              <div key={grupo}>
                <div className="ctx-nav-grupo">{grupo}</div>
                {modulos
                  .filter((m) => m.grupo === grupo)
                  .map((m) => {
                    const Icono = m.icono
                    const activo = m.id === modulo.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className="ctx-nav-item ctx-t"
                        data-ctx-activo={activo ? 'true' : 'false'}
                        aria-current={activo ? 'page' : undefined}
                        onClick={() => set({ modulo: m.id })}
                      >
                        <Icono size={14} strokeWidth={2} aria-hidden />
                        <span className="ctx-trunc">{m.nombre}</span>
                        {m.contador !== undefined && (
                          <span className="ctx-contador" data-ctx-tono={m.contadorTono === 'neutro' ? 'neutro' : 'accion'}>
                            {m.contador}
                          </span>
                        )}
                      </button>
                    )
                  })}
              </div>
            ))}
          </div>
        </nav>

        {/* ---------------- CONTENIDO ---------------- */}
        <main className="ctx-main">{children}</main>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El selector de cuenta                                               */
/* ------------------------------------------------------------------ */

function SelectorDeCuenta({ estado, set }: { estado: EstadoArmazon; set: (p: Partial<EstadoArmazon>) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [busca, setBusca] = useState('')
  const caja = useRef<HTMLDivElement>(null)
  const espacio = ESPACIOS.find((e) => e.id === estado.espacio)!
  const enCliente = espacio.conCuenta

  useEffect(() => {
    if (!abierto) return
    function fuera(ev: MouseEvent) {
      if (caja.current && !caja.current.contains(ev.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  const lista = CUENTAS.filter((c) => c.nombre.toLowerCase().includes(busca.toLowerCase()))

  return (
    <div ref={caja} style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        className="ctx-selector ctx-t"
        data-ctx-activo={enCliente ? 'true' : 'false'}
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="listbox"
        title={
          enCliente
            ? `Estás trabajando sobre ${estado.cuenta.nombre}. Cambiar de cuenta no te saca de esta pantalla.`
            : 'Herramientas internas: esto no es de ningún cliente'
        }
      >
        <span className="ctx-selector-sigla" data-ctx-interno={enCliente ? 'false' : 'true'} aria-hidden>
          {enCliente ? estado.cuenta.sigla : <Building2 size={11} strokeWidth={2.4} />}
        </span>
        <span className="ctx-selector-txt">
          <span
            className="ctx-trunc"
            style={{ fontSize: 12, lineHeight: '14px', fontWeight: 600, color: 'var(--ctx-fg)' }}
          >
            {enCliente ? estado.cuenta.nombre : 'Sin cuenta'}
          </span>
          {/* 11 px, que es el suelo que se impone la escala de tokens.ts. Este
              texto dice en qué mercado estás trabajando: no es decoración. */}
          <span className="ctx-trunc" style={{ fontSize: 11, lineHeight: '14px', color: 'var(--ctx-fg-3)' }}>
            {enCliente ? estado.cuenta.mercado : 'Herramientas internas'}
          </span>
        </span>
        <ChevronDown size={13} style={{ flex: 'none', color: 'var(--ctx-fg-3)' }} aria-hidden />
      </button>

      {abierto && (
        <div className="ctx-pop" role="listbox">
          <div style={{ padding: 4 }}>
            <input
              className="ctx-input"
              autoFocus
              placeholder="Buscar cuenta…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div className="ctx-pop-grupo">Mis clientes · {CUENTAS.length} cuentas</div>
          {lista.map((c) => {
            const activo = c.id === estado.cuenta.id && espacio.conCuenta
            const ej = ESTADO_EJECUCION[c.stock]
            const IconoEj = ej.icono
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={activo}
                className="ctx-pop-item ctx-t"
                data-ctx-activo={activo ? 'true' : 'false'}
                onClick={() => {
                  // Cambiar de cuenta NO te devuelve al inicio: se conserva el módulo.
                  set({ cuenta: c, espacio: 'clientes', modulo: espacio.conCuenta ? estado.modulo : 'resumen' })
                  setAbierto(false)
                  setBusca('')
                }}
              >
                <span className="ctx-sigla" aria-hidden>
                  {c.sigla}
                </span>
                <span className="ctx-trunc ctx-crece">{c.nombre}</span>
                <IconoEj size={12} strokeWidth={2.4} aria-hidden style={{ color: `var(--ctx-${ej.tono})`, flex: 'none' }} />
                <span style={{ fontSize: 11, color: 'var(--ctx-fg-3)', flex: 'none' }}>{ej.etiqueta}</span>
                {activo && <Check size={13} aria-hidden style={{ color: 'var(--ctx-marca-texto)', flex: 'none' }} />}
              </button>
            )
          })}

          <div className="ctx-pop-grupo" style={{ borderTop: '1px solid var(--ctx-line)', marginTop: 4, paddingTop: 8 }}>
            Sin cuenta
          </div>
          <button
            type="button"
            className="ctx-pop-item ctx-t"
            data-ctx-activo={!espacio.conCuenta ? 'true' : 'false'}
            onClick={() => {
              set({ espacio: 'agencia', modulo: 'cold-calling' })
              setAbierto(false)
            }}
          >
            <span className="ctx-sigla" aria-hidden>
              <Building2 size={11} strokeWidth={2.4} />
            </span>
            <span className="ctx-crece">Herramientas internas</span>
          </button>

          <div
            className="ctx-sm"
            style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--ctx-line)', marginTop: 4 }}
          >
            Cambiar de cuenta te deja en la misma pantalla, con los datos del otro cliente.
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La tarjeta de contexto de la cuenta, en la navegación               */
/* ------------------------------------------------------------------ */

function TarjetaCuenta({ cuenta }: { cuenta: Cuenta }) {
  const con = ESTADO_CONEXION[cuenta.conexion]
  const ej = ESTADO_EJECUCION[cuenta.stock]
  const IconoCon = con.icono
  const IconoEj = ej.icono
  return (
    <div className="ctx-nav-cuenta">
      <div className="ctx-fila-flex" style={{ gap: 6 }}>
        <span className="ctx-sigla" aria-hidden>
          {cuenta.sigla}
        </span>
        <span className="ctx-crece" style={{ minWidth: 0 }}>
          <span className="ctx-trunc" style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
            {cuenta.nombre}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ctx-fg-3)' }}>
            {cuenta.mercado} · {cuenta.sku.toLocaleString('es-ES')} SKU
          </span>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
        <span className="ctx-fila-flex" style={{ gap: 6, fontSize: 11 }}>
          <IconoCon size={12} strokeWidth={2.4} aria-hidden style={{ color: `var(--ctx-${con.tono})`, flex: 'none' }} />
          <span className="ctx-fg2">Conexión: {con.etiqueta}</span>
        </span>
        <span className="ctx-fila-flex" style={{ gap: 6, fontSize: 11 }}>
          <IconoEj size={12} strokeWidth={2.4} aria-hidden style={{ color: `var(--ctx-${ej.tono})`, flex: 'none' }} />
          <span className="ctx-fg2">
            Stock: {ej.etiqueta} · {cuenta.stockCuando}
          </span>
        </span>
      </div>
    </div>
  )
}
