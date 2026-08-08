'use client'

import React from 'react'
import { ChevronRight, Lock, Megaphone, Send, ShieldCheck } from 'lucide-react'
import { CUENTAS, MI_DIA, type Cuenta } from './datos'
import { MODULOS, ORDEN_GRUPOS, type EspacioId } from './navegacion'
import { Caja, ESTADO_CONEXION, ESTADO_EJECUCION } from './piezas'

/**
 * PANTALLA 1 — la portada.
 *
 * Lo que hay hoy: dieciocho tarjetas de 202 px de alto, todas iguales, todas con el
 * mismo icono naranja de 48 px, para tres líneas de texto cada una. A 1080 px de
 * ventana se ven catorce de dieciocho; a 780 px, ocho. Y la única información viva
 * de toda la pantalla —los leads web sin leer— compite en igualdad con «Usos
 * horarios».
 *
 * Lo que se propone: la portada deja de ser un menú (para eso está el carril, que ya
 * está siempre a la vista) y pasa a ser un PARTE. Tres bloques, y el orden importa:
 *
 *   1. MI DÍA        — lo mío. Es lo único que se agrega libremente, porque son mis
 *                      horas y mis citas.
 *   2. MIS CUENTAS   — las dieciséis, una línea cada una, con el estado de NUESTROS
 *                      procesos sobre cada una. Es lo que hoy no existe en ninguna
 *                      pantalla del ERP.
 *   3. ACCESOS       — todo lo demás, una línea por módulo, en tres columnas.
 *
 * CUMPLIMIENTO — y esto condiciona el diseño, no es una nota al pie:
 * lo firmado ante Amazon prohíbe agregar o comparar datos ENTRE clientes. Por eso
 * esta lista:
 *   · no tiene fila de totales, ni medias, ni «top 5»;
 *   · no se puede ordenar por ningún dato de negocio del cliente (ni facturación,
 *     ni ACOS, ni unidades). Solo por nombre y por si NOSOTROS tenemos algo
 *     pendiente ahí;
 *   · lo que se enseña por cuenta es el estado de nuestro propio trabajo —¿se envió
 *     el stock?, ¿hay cambios sin mandar?, ¿está revisada la semana de campañas?—,
 *     no el rendimiento del cliente;
 *   · NO hay columna de SKU. La hubo, y era la única casilla que se salía de esta
 *     misma regla: el tamaño del catálogo no es estado de un proceso nuestro, es
 *     dato de catálogo de Amazon del cliente, y dieciséis de ellos en una columna
 *     alineada a la derecha se comparan de un vistazo sin necesidad de ordenar.
 *     El dato no se pierde: está en la tarjeta de contexto de la cuenta activa
 *     (Armazon.tsx), donde se ve UNA, que es donde sí significa «el tamaño del
 *     catálogo que vas a abrir».
 * La regla queda escrita EN LA PANTALLA, no solo en el código, porque el día que
 * alguien pida «una columna de facturación aquí» hay que poder señalar dónde pone
 * que no.
 */

export function PantallaInicio({
  onAbrirCuenta,
  onIr,
}: {
  onAbrirCuenta: (c: Cuenta) => void
  onIr: (espacio: EspacioId, modulo: string) => void
}) {
  const conAlgoPendiente = CUENTAS.filter(
    (c) => c.sinEnviar > 0 || c.adsPendiente || c.stock === 'frenado' || c.stock === 'error' || c.conexion !== 'activa'
  ).length

  return (
    <div className="ctx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      {/* ---------------- 1. MI DÍA ---------------- */}
      <section className="ctx-panel">
        <div className="ctx-panel-cab">
          <span className="ctx-lg">Buenos días, {MI_DIA.nombre}</span>
          <span className="ctx-sm">viernes, 8 de agosto</span>
          <span className="ctx-crece" />
          <button type="button" className="ctx-btn ctx-btn--fino ctx-t" onClick={() => onIr('mio', 'horas')}>
            Fichar salida
          </button>
        </div>
        <div className="ctx-panel-cuerpo" style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <div className="ctx-cifras" style={{ height: 56, alignSelf: 'flex-start' }}>
            <MiCifra etiqueta="Hoy" valor={MI_DIA.horasHoy} sub="fichadas" />
            <MiCifra etiqueta="Esta semana" valor={MI_DIA.horasSemana} sub="de 40 h" />
            <MiCifra etiqueta="Vacaciones" valor={`${MI_DIA.vacaciones.disponibles} días`} sub="que puedes pedir" />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ctx-xs" style={{ marginBottom: 6 }}>
              LO QUE TIENES HOY
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {MI_DIA.citasHoy.map((c) => (
                <div key={c.hora} className="ctx-fila-flex" style={{ gap: 8, height: 20 }}>
                  <span className="ctx-num ctx-fg2" style={{ width: 42, fontWeight: 600, fontSize: 12 }}>
                    {c.hora}
                  </span>
                  <span className="ctx-md ctx-trunc">{c.que}</span>
                  <span className="ctx-sm" style={{ flex: 'none' }}>
                    · {c.donde}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 2. MIS CUENTAS ---------------- */}
      <section className="ctx-panel">
        <div className="ctx-panel-cab">
          <span className="ctx-lg">Mis clientes</span>
          <span className="ctx-sm">
            {CUENTAS.length} cuentas · {conAlgoPendiente} con algo nuestro pendiente
          </span>
          <span className="ctx-crece" />
          <span
            className="ctx-fila-flex ctx-sm"
            style={{ gap: 5, color: 'var(--ctx-fg-3)' }}
            title="Lo firmado ante Amazon prohíbe agregar o comparar datos entre clientes. Esta lista enseña cada cuenta por separado y solo el estado de nuestros propios procesos."
          >
            <ShieldCheck size={13} aria-hidden />
            Sin totales ni comparativas entre cuentas
          </span>
        </div>

        <div className="ctx-cuentas">
          <div
            className="ctx-cuenta-fila ctx-xs"
            style={{ height: 24, background: 'var(--ctx-surface-2)', borderBottom: '1px solid var(--ctx-line-2)' }}
          >
            <span />
            <span>CUENTA</span>
            <span>CONEXIÓN</span>
            <span>STOCK DE HOY</span>
            <span>NUESTRO TRABAJO</span>
            <span />
          </div>

          {CUENTAS.map((c) => (
            <FilaCuenta key={c.id} cuenta={c} onAbrir={() => onAbrirCuenta(c)} />
          ))}
        </div>
      </section>

      {/* ---------------- 3. ACCESOS ---------------- */}
      <section className="ctx-panel">
        <div className="ctx-panel-cab">
          <span className="ctx-lg">Todo lo demás</span>
          <span className="ctx-sm">Lo mío y lo de la agencia. Nada de esto cuelga de un cliente.</span>
        </div>
        <div className="ctx-panel-cuerpo" style={{ display: 'flex', gap: 24 }}>
          {(['mio', 'agencia'] as EspacioId[]).map((esp) => (
            <div key={esp} style={{ flex: esp === 'agencia' ? 2.4 : 1, minWidth: 0 }}>
              <div className="ctx-xs" style={{ marginBottom: 6 }}>
                {esp === 'mio' ? 'MI TRABAJO' : 'AGENCIA'}
              </div>
              <div
                className="ctx-accesos"
                style={{ gridTemplateColumns: esp === 'mio' ? '1fr' : 'repeat(3, minmax(0,1fr))' }}
              >
                {ORDEN_GRUPOS[esp].flatMap((g) =>
                  MODULOS[esp]
                    .filter((m) => m.grupo === g)
                    .map((m) => {
                      const Icono = m.icono
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className="ctx-acceso ctx-t"
                          onClick={() => onIr(esp, m.id)}
                        >
                          <Icono size={14} strokeWidth={2} aria-hidden />
                          <span className="ctx-trunc ctx-crece">{m.nombre}</span>
                          {m.soloAdmin && <Lock size={11} aria-hidden style={{ color: 'var(--ctx-mute)' }} />}
                          {m.contador !== undefined && (
                            <span
                              className="ctx-contador"
                              data-ctx-tono={m.contadorTono === 'neutro' ? 'neutro' : 'accion'}
                            >
                              {m.contador}
                            </span>
                          )}
                        </button>
                      )
                    })
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Caja tipo="info">
        <strong>Por qué la portada ya no es una rejilla de dieciocho tarjetas.</strong> El menú está
        permanentemente en el carril de la izquierda, así que la portada no tiene que serlo otra vez.
        Aquí caben las 16 cuentas y los 15 accesos —31 destinos— en el alto que hoy ocupan 14 tarjetas
        de las 18.
      </Caja>
    </div>
  )
}

function MiCifra({ etiqueta, valor, sub }: { etiqueta: string; valor: string; sub: string }) {
  return (
    <div className="ctx-cifra" style={{ flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: 0, padding: '0 14px' }}>
      <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--ctx-fg-3)' }}>{etiqueta}</span>
      <span className="ctx-num" style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600 }}>
        {valor}
      </span>
      <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--ctx-fg-3)' }}>{sub}</span>
    </div>
  )
}

function FilaCuenta({ cuenta, onAbrir }: { cuenta: Cuenta; onAbrir: () => void }) {
  const con = ESTADO_CONEXION[cuenta.conexion]
  const ej = ESTADO_EJECUCION[cuenta.stock]
  const IconoCon = con.icono
  const IconoEj = ej.icono

  return (
    <button type="button" className="ctx-cuenta-fila ctx-t" onClick={onAbrir}>
      <span className="ctx-sigla" aria-hidden>
        {cuenta.sigla}
      </span>

      <span style={{ minWidth: 0, textAlign: 'left' }}>
        <span className="ctx-trunc" style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
          {cuenta.nombre}
        </span>
      </span>

      {/* Aquí iba la columna SKU. Se quitó a propósito: ver la cabecera del
          fichero. El tamaño del catálogo se enseña en la tarjeta de la cuenta
          activa, de una en una. */}

      <span className="ctx-fila-flex" style={{ gap: 6, fontSize: 12 }}>
        <IconoCon size={13} strokeWidth={2.4} aria-hidden style={{ color: `var(--ctx-${con.tono})`, flex: 'none' }} />
        <span className={con.tono === 'ok' ? 'ctx-fg3' : ''} style={con.tono === 'ok' ? undefined : { color: `var(--ctx-${con.tono})`, fontWeight: 500 }}>
          {con.etiqueta}
        </span>
      </span>

      <span className="ctx-fila-flex" style={{ gap: 6, fontSize: 12 }} title={ej.explica}>
        <IconoEj size={13} strokeWidth={2.4} aria-hidden style={{ color: `var(--ctx-${ej.tono})`, flex: 'none' }} />
        <span className={ej.tono === 'ok' || ej.tono === 'neutro' ? 'ctx-fg3' : ''} style={ej.tono === 'ok' || ej.tono === 'neutro' ? undefined : { color: `var(--ctx-${ej.tono})`, fontWeight: 500 }}>
          {ej.etiqueta}
        </span>
        {/* `ctx-fg3`, no `ctx-mute`: la hora del último envío es un DATO —a qué
            hora se le mandó el stock a este cliente—, no el guion de «no hay
            nada». `mute` está medido contra 3:1 porque no debe llevar
            información encima, y a 11 px sobre la fila bajo el ratón daba 3,01. */}
        {cuenta.stockCuando !== '—' && <span className="ctx-fg3" style={{ fontSize: 11 }}>{cuenta.stockCuando}</span>}
      </span>

      <span className="ctx-fila-flex" style={{ gap: 8, fontSize: 12 }}>
        {cuenta.sinEnviar > 0 && (
          <span className="ctx-fila-flex" style={{ gap: 4, color: 'var(--ctx-marca-texto)', fontWeight: 600 }}>
            <Send size={12} strokeWidth={2.4} aria-hidden />
            {cuenta.sinEnviar} sin enviar
          </span>
        )}
        {cuenta.adsPendiente && (
          <span className="ctx-fila-flex ctx-fg3" style={{ gap: 4 }}>
            <Megaphone size={12} strokeWidth={2.4} aria-hidden />
            Ads sin revisar
          </span>
        )}
        {cuenta.sinEnviar === 0 && !cuenta.adsPendiente && <span className="ctx-mute">—</span>}
      </span>

      <ChevronRight size={14} aria-hidden style={{ color: 'var(--ctx-mute)' }} />
    </button>
  )
}
