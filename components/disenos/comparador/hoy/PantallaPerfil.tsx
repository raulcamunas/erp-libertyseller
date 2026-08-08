'use client'

import { FlaskConical } from 'lucide-react'
import { MarcoHoy, TituloHoy, type TemaHoy } from './Marco'
import {
  EJECUCIONES_HOY,
  FRENOS_APAGADOS,
  FRENOS_HOY,
  PRUEBA_HOY,
  SECCIONES_HOY,
  type CampoHoy,
} from './datos'

/**
 * PANTALLA 3 — `/dashboard/amazon-api` → Automatización → la configuración de un
 * perfil de lectura, como está hoy.
 *
 * Réplica del marcado de components/amazon/PerfilConfig.tsx: secciones
 * `rounded-2xl border-white/10 bg-white/[0.02] p-3`, título de sección a 12 px,
 * pista de sección a `text-[10px] text-white/35`, etiqueta de campo a
 * `text-[10px] uppercase tracking-wider text-white/35` y nota bajo cada campo al
 * mismo `text-white/35`.
 *
 * Aquí caen los PEORES contrastes medidos de todo el ERP: 3,17:1 en oscuro para
 * las etiquetas y las notas, que son justo lo que hace la pantalla usable, y
 * 4,05:1 en claro. Son ~50 campos que configuran lo que se escribe en la tienda
 * de un cliente.
 *
 * Se conserva lo que hay que no perder: no hay botón de guardar —cada campo se
 * guarda al salir de él— y los cinco estados de ejecución con `simulacro` en
 * GRIS y no en verde, a conciencia.
 *
 * Y se ve el problema que eso deja abierto: un freno puesto y un freno APAGADO
 * se distinguen hoy solo por si el hueco tiene número o tiene un marcador de
 * posición gris; y al no haber botón de guardar, tampoco hay ninguna señal de
 * que lo que acabas de teclear haya quedado escrito.
 */

const TONOS = {
  zinc: { color: 'var(--hoy-zinc)', fondo: 'var(--hoy-zinc-fondo)', borde: 'var(--hoy-zinc-borde)' },
  ambar: { color: 'var(--hoy-ambar)', fondo: 'var(--hoy-ambar-fondo)', borde: 'var(--hoy-ambar-borde)' },
  verde: { color: 'var(--hoy-verde)', fondo: 'var(--hoy-verde-fondo)', borde: 'var(--hoy-verde-borde)' },
  rojo: { color: 'var(--hoy-rojo)', fondo: 'var(--hoy-rojo-fondo)', borde: 'var(--hoy-rojo-borde)' },
}

function Campo({ campo }: { campo: CampoHoy }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label className="hoy-rotulo" style={{ display: 'block', marginBottom: 4 }}>
        {campo.etiqueta}
        {campo.obligatorio && <span style={{ color: 'var(--hoy-marca-texto)' }}> *</span>}
      </label>
      <input className="hoy-campo" defaultValue={campo.valor} placeholder={campo.marcador} />
      {campo.nota && (
        <p className="hoy-nota" style={{ marginTop: 4 }}>
          {campo.nota}
        </p>
      )}
    </div>
  )
}

export function PantallaPerfilHoy({ tema }: { tema: TemaHoy }) {
  return (
    <MarcoHoy tema={tema} activo="amazon-api">
      <TituloHoy
        titulo="Amazon API"
        sub="El catálogo de los clientes que nos han dado acceso a su cuenta de Amazon: precios y stock, con los cambios que salgan de aquí registrados uno a uno."
      />

      {/* Pestañas del módulo */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flex: '0 0 auto' }}>
        <button type="button" className="hoy-chip">
          Catálogo
        </button>
        <button type="button" className="hoy-chip">
          Conexiones
        </button>
        <button type="button" className="hoy-chip" data-on="1">
          Automatización
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, minHeight: 0, flex: 1 }}>
        {/* Columna izquierda: el perfil */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SECCIONES_HOY.map((s) => (
            <div key={s.titulo} className="hoy-seccion">
              <h3 className="hoy-seccion-tit">{s.titulo}</h3>
              <p className="hoy-seccion-hint" style={{ marginBottom: 10 }}>
                {s.hint}
              </p>
              {s.info && (
                <div className="hoy-caja" data-tipo="info" style={{ marginBottom: 10 }}>
                  {s.info}
                </div>
              )}
              <div className="hoy-rejilla-campos">
                {s.campos.map((c) => (
                  <Campo key={c.etiqueta} campo={c} />
                ))}
              </div>
            </div>
          ))}

          {/* Frenos: el bloque con más carga de la pantalla */}
          <div className="hoy-seccion">
            <h3 className="hoy-seccion-tit">Frenos</h3>
            <p className="hoy-seccion-hint" style={{ marginBottom: 10 }}>
              Si salta uno, no se manda nada
            </p>

            <div className="hoy-caja" data-tipo="info" style={{ marginBottom: 8 }}>
              Un fichero mal exportado un martes por la noche no puede vaciar el inventario de un
              cliente quince minutos después sin que nadie lo vea.
            </div>

            <div className="hoy-caja" data-tipo="aviso" style={{ marginBottom: 10 }}>
              {FRENOS_APAGADOS}
            </div>

            <div className="hoy-rejilla-campos">
              {FRENOS_HOY.map((f) => (
                <div key={f.etiqueta} style={{ minWidth: 0 }}>
                  <label className="hoy-rotulo" style={{ display: 'block', marginBottom: 4 }}>
                    {f.etiqueta}
                  </label>
                  <input
                    className="hoy-campo hoy-num"
                    defaultValue={f.valor}
                    placeholder="Vacío = no se evalúa"
                  />
                  <p className="hoy-nota" style={{ marginTop: 4 }}>
                    {f.nota}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Columna derecha: probar e historial */}
        <div style={{ width: 340, flex: '0 0 340px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="hoy-seccion">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <h3 className="hoy-seccion-tit">Probar</h3>
                <p className="hoy-seccion-hint">Lee el fichero real con la configuración de ahora</p>
              </div>
              <button type="button" className="hoy-btn-nuevo">
                <FlaskConical style={{ width: 13, height: 13 }} aria-hidden />
                Probar
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PRUEBA_HOY.map((p) => (
                <div key={p.campo} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11 }}>
                  <span style={{ color: 'var(--hoy-t45)', width: 130, flex: '0 0 130px' }}>{p.campo}</span>
                  <span style={{ color: 'var(--hoy-t80)' }}>{p.columna}</span>
                  <span className="hoy-num" style={{ color: 'var(--hoy-t30)', marginLeft: 'auto' }}>
                    {p.ejemplo}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="hoy-seccion" style={{ flex: 1, minHeight: 0 }}>
            <h3 className="hoy-seccion-tit">Últimas ejecuciones</h3>
            <p className="hoy-seccion-hint" style={{ marginBottom: 10 }}>
              Qué pasó cada mañana a las 06:30
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {EJECUCIONES_HOY.map((e) => {
                const t = TONOS[e.tono]
                return (
                  <div key={e.cuando} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        className="hoy-pildora"
                        style={{ color: t.color, backgroundColor: t.fondo, borderColor: t.borde }}
                      >
                        {e.estado}
                      </span>
                      <span className="hoy-num" style={{ fontSize: 10, color: 'var(--hoy-t40)' }}>
                        {e.cuando}
                      </span>
                    </div>
                    <p className="hoy-nota">{e.detalle}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </MarcoHoy>
  )
}
