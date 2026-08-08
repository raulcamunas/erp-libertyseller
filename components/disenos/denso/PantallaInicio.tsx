'use client'

import { ChevronRight } from 'lucide-react'
import { BarraLateral, BarraSuperior } from './Marco'
import { GRUPOS_APPS, HOY, MOVIMIENTOS } from './datos'

/**
 * PANTALLA 1 — la pantalla de inicio.
 *
 * Lo que había: dieciocho tarjetas de 202 px de alto, con dieciocho iconos
 * naranjas idénticos, para tres líneas de texto cada una. 1.408 px de página, y
 * en un portátil se ven ocho de dieciocho módulos. Ningún objeto pesa más que
 * otro, así que la insignia de leads sin abrir —la única información viva de
 * toda la pantalla— compite en igualdad con «Usos horarios».
 *
 * Lo que hay ahora: la jerarquía la pone LO QUE HA CAMBIADO. Arriba, «Hoy»:
 * seis líneas con lo que hay que hacer, y ahí es donde vive el naranja. Debajo,
 * los dieciocho módulos como una lista agrupada por el trabajo que hacen, a 30
 * px por línea. Y al lado, lo que ha pasado en la agencia desde ayer.
 *
 * La pantalla entera cabe sin scroll en un portátil de 1440×900.
 */
export function PantallaInicio() {
  return (
    <div className="dz-app">
      <BarraLateral activo="home" />

      <div className="dz-main">
        <BarraSuperior titulo="Inicio" contexto="viernes, 8 de agosto">
          <span className="dz-s dz-t3">Buenos días, Raúl</span>
        </BarraSuperior>

        <div className="dz-cuerpo" style={{ flexDirection: 'row', gap: 10 }}>
          {/* ---------- Columna principal ---------- */}
          <div
            className="dz-crece dz-scroll"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {/* Hoy */}
            <section className="dz-panel">
              <div className="dz-panel-cab">
                <span className="dz-l">Hoy</span>
                <span className="dz-s dz-t3">lo que está esperando a alguien</span>
              </div>
              <div className="dz-hoy">
                {HOY.map((h) => {
                  const Icono = h.icono
                  return (
                    <button
                      key={h.app + h.texto}
                      type="button"
                      className="dz-hoy-li"
                      data-urg={h.urgente ? '1' : undefined}
                    >
                      <Icono aria-hidden />
                      <span className="dz-hoy-n">{h.n}</span>
                      <span className="dz-hoy-txt">{h.texto}</span>
                      <ChevronRight
                        aria-hidden
                        style={{ width: 13, height: 13, color: 'var(--dz-t4)' }}
                      />
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Los dieciocho módulos */}
            <section className="dz-panel">
              <div className="dz-panel-cab">
                <span className="dz-l">Aplicaciones</span>
                <span className="dz-s dz-t3">18 módulos</span>
              </div>
              <div className="dz-panel-cuerpo" style={{ paddingTop: 2 }}>
                {GRUPOS_APPS.map((g) => (
                  <div key={g.grupo}>
                    <div className="dz-grupo" style={{ padding: '8px 8px 2px' }}>
                      {g.grupo}
                    </div>
                    <div className="dz-apps">
                      {g.apps.map((a) => {
                        const Icono = a.icono
                        return (
                          <button key={a.id} type="button" className="dz-app-li">
                            {/*
                              Icono monocromo de 14 px. El de hoy es un cuadro
                              de 48×48 en naranja al 10 %, repetido dieciocho
                              veces: es la prueba más clara de que el acento ha
                              dejado de significar nada. Aquí el naranja de esta
                              pantalla está solo en dos sitios: las dos líneas
                              urgentes de «Hoy» y la insignia de 23 leads.
                            */}
                            <Icono aria-hidden />
                            <span className="dz-app-n">{a.nombre}</span>
                            <span className="dz-app-d">{a.descripcion}</span>
                            {/*
                              Aquí NO va la insignia naranja aunque el módulo
                              tenga cosas pendientes: ya está arriba, en «Hoy»,
                              y repetirla treinta píxeles más abajo es volver a
                              gastar el acento en algo que ya estaba dicho. Esta
                              lista es un lanzador; el estado vive en «Hoy» y en
                              la barra lateral.
                            */}
                            {a.soloAdmin && (
                              <span className="dz-xs dz-t4" title="Solo administradores">
                                admin
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ---------- Columna de contexto ---------- */}
          <section className="dz-panel" style={{ width: 292, flex: '0 0 292px' }}>
            <div className="dz-panel-cab">
              <span className="dz-l">Últimos movimientos</span>
            </div>
            <div className="dz-scroll" style={{ padding: '2px 0' }}>
              {MOVIMIENTOS.map((m, i) => (
                <div
                  key={i}
                  style={{
                    padding: '6px 10px',
                    borderBottom:
                      i === MOVIMIENTOS.length - 1 ? 'none' : '1px solid var(--dz-linea)',
                  }}
                >
                  <div className="dz-fila-flex" style={{ gap: 6 }}>
                    <span className="dz-xs dz-t2">{m.quien}</span>
                    <span className="dz-crece" />
                    <span className="dz-s dz-t4" style={{ fontSize: 11 }}>
                      {m.cuando}
                    </span>
                  </div>
                  <div className="dz-s" style={{ marginTop: 1 }}>
                    {m.que}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
