'use client'

import { useState } from 'react'
import { AlertTriangle, Download, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { Boton, TACTIL } from '@/components/ui-ls'
import { CAMPO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { diaDeCreacionDeEnvio } from '@/lib/fba/mercados'
import type { AmazonRegion } from '@/lib/types/amazon'
import { cx } from '../comun/ui'

/**
 * TRAER UN ENVÍO QUE YA EXISTE EN AMAZON, POR SU NÚMERO FBA.
 *
 * Es lo contrario de montar la lista a mano: el envío ya está hecho en Seller
 * Central, así que lo que se mandó y lo que ha llegado lo dice Amazon. Se busca,
 * se revisa lo que ha devuelto y se trae. A partir de ahí se sigue solo: su estado
 * cada hora y lo que se va vendiendo cada día.
 *
 * Quien lo monta, en `onTraido`, hace el `router.refresh()` de siempre seguido de `invalidarRemesas(clienteId)`.
 */

const FBA = /^FBA[0-9A-Z]{6,20}$/

interface Traido {
  existente: { id: string; nombre: string | null } | null
  envio: { shipmentId: string; nombre: string | null; estado: string; centro: string | null }
  /** El mercado en el que el servidor ha buscado el envío (el de la cuenta, no siempre España) y en el que se creará */
  mercado: { id: string; nombre: string; region: AmazonRegion | null }
  lineas: Array<{ sku: string; enviadas: number; recibidas: number; nombre: string | null; asin: string | null }>
}

export function TraerEnvioDialog({
  clienteId,
  clienteNombre,
  marketplaceId = 'A1RKKUPIHCS9HS',
  onCerrar,
  onTraido,
}: {
  clienteId: string
  clienteNombre: string
  marketplaceId?: string
  onCerrar: () => void
  onTraido: (id: string) => void
}) {
  const [numero, setNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [traido, setTraido] = useState<Traido | null>(null)
  const [error, setError] = useState<string | null>(null)

  const limpio = numero.trim().toUpperCase()
  const valido = FBA.test(limpio)

  async function buscar() {
    setBuscando(true)
    setError(null)
    setTraido(null)
    try {
      const res = await fetch('/api/fba/remesas/importar-envio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'buscar', clienteId, marketplaceId, shipmentId: limpio }),
      })
      const p = (await res.json().catch(() => null)) as ({ error?: string } & Partial<Traido>) | null
      if (!res.ok || !p?.envio || !p.lineas) {
        setError(p?.error ?? 'No se ha podido consultar el envío')
        return
      }
      const mercado = p.mercado ?? { id: marketplaceId, nombre: 'España', region: null }
      setTraido({ existente: p.existente ?? null, envio: p.envio, mercado, lineas: p.lineas })
      if (!nombre.trim() && p.envio.nombre) setNombre(p.envio.nombre)
      // Los envíos de Amazon se llaman «FBA STA (06/10/2026 10:17)»: lleva el día de creación, que es una
      // fecha de envío mucho mejor que la de hoy. El orden de los números es el del país de la cuenta:
      // «07/08/2026» es 8 de julio en Estados Unidos y 7 de agosto en España.
      const dia = diaDeCreacionDeEnvio(p.envio.nombre, mercado.region)
      if (dia) setFecha(dia)
    } finally {
      setBuscando(false)
    }
  }

  async function traer() {
    if (!traido || traido.existente) return
    setGuardando(true)
    try {
      const res = await fetch('/api/fba/remesas/importar-envio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // El mercado que dijo el servidor al buscar, no el que lleva el diálogo por costumbre
        body: JSON.stringify({ accion: 'crear', clienteId, marketplaceId: traido.mercado.id, shipmentId: traido.envio.shipmentId, nombre: nombre.trim() || null, fechaEnvio: fecha }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; id?: string } | null
      if (!res.ok || !p?.id) {
        toast.error(p?.error ?? 'No se ha podido traer el envío')
        return
      }
      toast.success(`Envío traído de Amazon: ${traido.lineas.length} referencias`)
      // Las ventas se leen solas desde este envío (el servidor decide si hace falta ir más atrás); solo la agencia puede lanzarlo, si no, lo recoge la pasada de la noche
      void fetch(`/api/fba/sincronizar?remesa=${encodeURIComponent(p.id)}`, { method: 'POST' }).catch(() => undefined)
      onCerrar()
      onTraido(p.id)
    } finally {
      setGuardando(false)
    }
  }

  const enviadas = traido?.lineas.reduce((s, l) => s + l.enviadas, 0) ?? 0
  const recibidas = traido?.lineas.reduce((s, l) => s + l.recibidas, 0) ?? 0

  return (
    <Dialogo
      titulo="Traer un envío de Amazon"
      entradilla={`Para ${clienteNombre}. Escribe el número de envío FBA —el que empieza por FBA, en Seller Central → Gestionar envíos— y Amazon dice qué se mandó y qué ha recibido.`}
      onCerrar={onCerrar}
      ancho="max-w-[760px]"
      pie={
        <>
          <Boton tamano="sm" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton tamano="sm" variante="primario" icono={Download} cargando={guardando} onClick={() => void traer()} disabled={!traido || !!traido.existente}>
            Traer este envío
          </Boton>
        </>
      }
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (valido && !buscando) void buscar()
        }}
      >
        <div className="min-w-[180px] flex-1">
          <label className={CAMPO.etiqueta} htmlFor="te-numero">
            Número de envío FBA
          </label>
          <input id="te-numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="FBA15ABCDEF" spellCheck={false} autoFocus className={cx(CAMPO.input, 'h-9 rounded-[10px] px-3 font-mono text-[13px]', TACTIL)} />
        </div>
        <Boton type="submit" tamano="md" variante={traido ? 'secundario' : 'primario'} icono={Search} cargando={buscando} disabled={!valido}>
          Buscar en Amazon
        </Boton>
      </form>

      {error && (
        <div className="flex items-start gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--ls-t1)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.rojo}` }} role="alert">
          <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
          {error}
        </div>
      )}

      {traido && (
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--ls-t3)]">
            <b className="font-semibold text-[var(--ls-t1)]">{traido.envio.nombre ?? traido.envio.shipmentId}</b> · {ESTADO_INBOUND_TEXTO[traido.envio.estado]?.texto ?? traido.envio.estado}
            {traido.envio.centro ? ` · destino ${traido.envio.centro}` : ''} · <span title="El país de Amazon en el que se ha buscado el envío y en el que se creará">Amazon {traido.mercado.nombre}</span> ·{' '}
            <b className="font-semibold text-[var(--ls-t1)]">{traido.lineas.length}</b> referencias,{' '}
            <b className="font-semibold text-[var(--ls-t1)]">{enviadas.toLocaleString('es-ES')}</b> unidades enviadas y {recibidas.toLocaleString('es-ES')} recibidas
          </p>

          {traido.existente ? (
            <div className="flex items-start gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t1)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
              <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
              Este envío ya está en el ERP{traido.existente.nombre ? ` como «${traido.existente.nombre}»` : ''}. No se vuelve a crear.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={CAMPO.etiqueta} htmlFor="te-nombre">
                  Nombre
                </label>
                <input id="te-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={cx(CAMPO.input, 'h-9 rounded-[10px] px-3 text-[13px]', TACTIL)} />
              </div>
              <div>
                <label className={CAMPO.etiqueta} htmlFor="te-fecha">
                  Fecha de envío
                </label>
                <input id="te-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={cx(CAMPO.input, 'h-9 rounded-[10px] px-3 text-[13px]', TACTIL)} />
                <p className={CAMPO.nota}>Desde aquí empiezan a contar las ventas, hasta que Amazon confirme la llegada.</p>
              </div>
            </div>
          )}

          <div className="max-h-[260px] overflow-auto rounded-[10px] border border-[var(--ls-linea)]">
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={TABLA.cabecera}>SKU</th>
                  <th className={TABLA.cabecera}>Producto</th>
                  <th className={cx(TABLA.cabecera, TABLA.derecha)}>Enviadas</th>
                  <th className={cx(TABLA.cabecera, TABLA.derecha)}>Recibidas</th>
                </tr>
              </thead>
              <tbody>
                {traido.lineas.map((l) => (
                  <tr key={l.sku} className={TABLA.fila}>
                    <td className={cx(TABLA.celda, 'font-mono text-[11.5px] text-[var(--ls-t3)]')}>{l.sku}</td>
                    <td className={cx(TABLA.celda, 'max-w-[140px] truncate text-[var(--ls-t1)] sm:max-w-[340px]')}>{l.nombre ?? '—'}</td>
                    <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{l.enviadas}</td>
                    <td className={cx(TABLA.celda, TABLA.numero)} style={l.recibidas < l.enviadas ? { color: COLOR_ESTADO.ambar } : undefined}>
                      {l.recibidas}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialogo>
  )
}
