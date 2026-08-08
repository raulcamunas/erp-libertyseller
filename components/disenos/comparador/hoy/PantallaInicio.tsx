'use client'

import { MarcoHoy, type TemaHoy } from './Marco'
import { MODULOS_HOY, LEADS_SIN_LEER } from './datos'

/**
 * PANTALLA 1 — `/dashboard`, la rejilla de inicio, como está hoy.
 *
 * Réplica del marcado de app/dashboard/page.tsx: `glass-card p-6` por módulo en
 * una rejilla de 4 columnas con `gap-6`, icono de 48 px en
 * `bg-[#FF6600]/[0.1] text-[#FF6600]` —los DIECIOCHO iguales—, título de 18 px,
 * descripción de 14 px a `text-white/50` y una tarjeta de bienvenida al final
 * con el rol en crudo.
 *
 * Medido en el informe: 202 px por tarjeta y ~1.408 px de página. A 940 px de
 * ventana se ven doce de dieciocho módulos; a 780, ocho.
 *
 * En tema claro, las 18 tarjetas se quedan sin borde y sin superficie: el
 * `brightness(1.1)` de glass-card satura a blanco puro sobre #F5F5F7 (1,09:1) y
 * su borde blanco al 15 % es invisible (1,01:1). No hay que buscarlo: se ve solo.
 */
export function PantallaInicioHoy({ tema }: { tema: TemaHoy }) {
  return (
    <MarcoHoy tema={tema} activo="home">
      <div style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 className="hoy-h1">Aplicaciones Instaladas</h1>
          <p className="hoy-sub">Selecciona una aplicación para comenzar</p>
        </div>

        <div className="hoy-rejilla">
          {MODULOS_HOY.map((app) => {
            const Icono = app.icon
            return (
              <div key={app.id} className="hoy-cristal hoy-app">
                <div className="hoy-app-icono">
                  <Icono aria-hidden />
                </div>
                <h3 className="hoy-app-tit">{app.name}</h3>
                <p className="hoy-app-desc">{app.description}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, minHeight: 20 }}>
                  {app.id === 'web-leads' && (
                    <span
                      className="hoy-pildora"
                      style={{
                        background: 'var(--hoy-marca)',
                        borderColor: 'var(--hoy-marca)',
                        color: 'var(--hoy-marca-tinta)',
                      }}
                    >
                      {LEADS_SIN_LEER} nuevos
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="hoy-cristal" style={{ padding: 32, marginTop: 32 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Bienvenido, Raúl</h2>
          <p style={{ fontSize: 14, color: 'var(--hoy-t50)', marginBottom: 16 }}>
            Este es tu panel de control de Liberty Seller Hub.
          </p>
          <span
            className="hoy-pildora"
            style={{
              background: 'var(--hoy-marca-suave)',
              borderColor: 'var(--hoy-marca-borde)',
              color: 'var(--hoy-marca-texto)',
            }}
          >
            admin
          </span>
        </div>
      </div>
    </MarcoHoy>
  )
}
