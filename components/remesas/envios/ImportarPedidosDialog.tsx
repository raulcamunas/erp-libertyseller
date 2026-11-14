'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Download, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { BOTON, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { EnvioNuevo } from '@/lib/fba/envios-nuevos'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { cx } from '../comun/ui'
import { fecha } from '../formato'

/**
 * IMPORTAR PEDIDOS: los envíos que Amazon tiene en la cuenta de este cliente y el ERP todavía no, para traerlos de golpe.
 *
 * Es lo contrario de «Traer envío de Amazon» (uno, tecleando su número FBA): aquí se le pregunta a Amazon qué hay, se marcan los que valen y se importan
 * todos. Los que se importan nacen ya enlazados y, a partir de ahí, se siguen solos (estado cada hora y ventas cada día).
 *
 * Se importan por TANDAS DE 4 (el servidor admite hasta 8 por llamada y cada envío son varias consultas a Amazon): se ve el avance y un fallo no tira los demás.
 */

const POR_TANDA = 4

interface Respuesta {
  nuevos?: EnvioNuevo[]
  error?: string | null
  sinConexion?: boolean
  comprobadoAt?: string
}

export function ImportarPedidosDialog({
  clienteId,
  clienteNombre,
  conPropuestasListas,
  onCerrar,
  onImportados,
  onManual,
}: {
  clienteId: string
  clienteNombre: string
  /** Hay propuestas ya encajadas esperando su número de Amazon: se avisa de que lo suyo es enlazarlas, no importarlas aparte */
  conPropuestasListas: boolean
  onCerrar: () => void
  /** Los envíos importados (ids de remesa), para refrescar y abrir el primero */
  onImportados: (ids: string[]) => void
  /** Pasar a traer uno por su número */
  onManual: () => void
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [falloDeRed, setFalloDeRed] = useState<string | null>(null)
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [importando, setImportando] = useState<{ hechos: number; total: number } | null>(null)
  const [errores, setErrores] = useState<Record<string, string>>({})

  const cargar = useCallback(
    async (refrescar: boolean) => {
      setCargando(true)
      setFalloDeRed(null)
      try {
        const res = await fetch(`/api/fba/remesas/envios-nuevos?clienteId=${clienteId}${refrescar ? '&refrescar=1' : ''}`)
        const p = (await res.json().catch(() => null)) as (Respuesta & { error?: string }) | null
        if (!res.ok || !p) {
          setFalloDeRed(p?.error ?? 'No se ha podido consultar Amazon')
          return
        }
        setDatos(p)
        // Por defecto, todos marcados: lo normal es traerlos todos
        setElegidos(new Set((p.nuevos ?? []).map((e) => e.shipmentId)))
      } catch {
        setFalloDeRed('No se ha podido consultar Amazon')
      } finally {
        setCargando(false)
      }
    },
    [clienteId]
  )

  useEffect(() => {
    void cargar(false)
  }, [cargar])

  const nuevos = useMemo(() => datos?.nuevos ?? [], [datos])
  const variosMercados = new Set(nuevos.map((e) => e.mercadoId)).size > 1
  const todos = nuevos.length > 0 && elegidos.size === nuevos.length

  function alternar(id: string) {
    setElegidos((a) => {
      const b = new Set(a)
      if (b.has(id)) b.delete(id)
      else b.add(id)
      return b
    })
  }

  async function importar() {
    const lista = nuevos.filter((e) => elegidos.has(e.shipmentId))
    if (lista.length === 0) return
    setErrores({})
    setImportando({ hechos: 0, total: lista.length })
    const creados: string[] = []
    let masAntiguo: { id: string; fecha: string } | null = null
    const fallos: Record<string, string> = {}
    for (let i = 0; i < lista.length; i += POR_TANDA) {
      const tanda = lista.slice(i, i + POR_TANDA)
      try {
        const res = await fetch('/api/fba/remesas/envios-nuevos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clienteId, envios: tanda.map((e) => ({ shipmentId: e.shipmentId, mercadoId: e.mercadoId })) }),
        })
        const p = (await res.json().catch(() => null)) as { error?: string; importados?: Array<{ id: string; fecha?: string }>; fallidos?: Array<{ shipmentId: string; error: string }> } | null
        if (!res.ok || !p) for (const e of tanda) fallos[e.shipmentId] = p?.error ?? 'No se ha podido importar'
        else {
          for (const m of p.importados ?? []) {
            creados.push(m.id)
            if (m.fecha && (!masAntiguo || m.fecha < masAntiguo.fecha)) masAntiguo = { id: m.id, fecha: m.fecha }
          }
          for (const f of p.fallidos ?? []) fallos[f.shipmentId] = f.error
        }
      } catch {
        for (const e of tanda) fallos[e.shipmentId] = 'Se ha cortado la conexión'
      }
      setImportando({ hechos: Math.min(lista.length, i + tanda.length), total: lista.length })
    }
    setImportando(null)
    setErrores(fallos)
    const nFallos = Object.keys(fallos).length
    if (creados.length > 0) {
      toast.success(creados.length === 1 ? 'Envío importado' : `${creados.length} envíos importados`)
      onImportados(creados)
      // Las ventas se leen solas desde el envío más antiguo que se acaba de traer: si no, el FIFO lo pinta intacto hasta la pasada de la noche. Tarda unos minutos
      // y solo la puede lanzar la agencia (si no, la pasada de la noche lo recoge igual); aquí no se espera a que acabe
      const desde = masAntiguo as { id: string; fecha: string } | null
      if (desde) {
        toast.message(`Leyendo las ventas desde el ${desde.fecha.split('-').reverse().join('/')}…`, { description: 'Tarda unos minutos. Puedes seguir trabajando: el FIFO se pone al día solo.' })
        void fetch(`/api/fba/sincronizar?remesa=${encodeURIComponent(desde.id)}`, { method: 'POST' }).catch(() => undefined)
      }
    }
    if (nFallos === 0) onCerrar()
    else {
      toast.error(`${nFallos} no se han podido importar: míralos en la lista`)
      // Se quitan de la lista los que sí han entrado y se dejan los que han fallado
      setDatos((d) => (d ? { ...d, nuevos: (d.nuevos ?? []).filter((e) => fallos[e.shipmentId] !== undefined) } : d))
      setElegidos(new Set(Object.keys(fallos)))
    }
  }

  return (
    <Dialogo
      titulo="Importar pedidos"
      entradilla={`Envíos que Amazon tiene en la cuenta de ${clienteNombre} (del último año) y que todavía no están en el ERP. Marca los que quieras traer.`}
      onCerrar={onCerrar}
      ancho="max-w-[820px]"
      pie={
        <>
          <button type="button" onClick={onManual} className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'mr-auto')} title="Traer uno solo, escribiendo su número FBA">
            Traer uno por su número
          </button>
          <button type="button" onClick={onCerrar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cerrar
          </button>
          <button type="button" onClick={importar} disabled={elegidos.size === 0 || importando !== null || cargando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
            {importando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {importando ? `Importando ${importando.hechos}/${importando.total}…` : `Importar ${elegidos.size > 0 ? elegidos.size : ''} ${elegidos.size === 1 ? 'envío' : 'envíos'}`.replace('  ', ' ')}
          </button>
        </>
      }
    >
      {conPropuestasListas && (
        <p className="rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
          Este cliente tiene propuestas ya encajadas. Si un envío de la lista es de una de ellas, no lo importes aparte: ábrela en <b>Propuestas</b> y enlázala con su número, para no tenerlo duplicado.
        </p>
      )}

      {cargando && !datos && (
        <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--ls-t3)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Preguntando a Amazon…
        </div>
      )}

      {falloDeRed && (
        <div className="flex items-start gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] text-[var(--ls-t1)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.rojo}` }} role="alert">
          <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
          {falloDeRed}
        </div>
      )}

      {datos?.sinConexion && <p className="py-8 text-center text-[12.5px] text-[var(--ls-t3)]">Este cliente no tiene conectada su cuenta de Amazon, así que no se pueden consultar sus envíos.</p>}

      {datos && !datos.sinConexion && datos.error && (
        <div className="flex items-start gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] text-[var(--ls-t1)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
          <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
          Amazon no ha contestado del todo: {datos.error}
        </div>
      )}

      {datos && !datos.sinConexion && nuevos.length === 0 && !datos.error && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]">
            <Check className="h-4 w-4" />
          </span>
          <p className="text-[13px] font-medium text-[var(--ls-t1)]">No hay envíos nuevos</p>
          <p className="max-w-[420px] text-[12px] text-[var(--ls-t3)]">Todo lo que Amazon tiene en esta cuenta, y que ya ha salido, está en el ERP.</p>
        </div>
      )}

      {nuevos.length > 0 && (
        <div className="max-h-[380px] overflow-auto rounded-[6px] border border-[var(--ls-linea)]">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={cx(TABLA.cabecera, 'w-[34px]')}>
                  <input type="checkbox" checked={todos} onChange={() => setElegidos(todos ? new Set() : new Set(nuevos.map((e) => e.shipmentId)))} aria-label="Marcar todos" />
                </th>
                <th className={TABLA.cabecera}>Envío</th>
                <th className={TABLA.cabecera}>Número FBA</th>
                <th className={TABLA.cabecera}>Estado en Amazon</th>
                <th className={TABLA.cabecera}>Creado</th>
              </tr>
            </thead>
            <tbody>
              {nuevos.map((e) => (
                <tr key={e.shipmentId} className={cx(TABLA.fila, 'cursor-pointer')} onClick={() => alternar(e.shipmentId)}>
                  <td className={TABLA.celda}>
                    <input type="checkbox" checked={elegidos.has(e.shipmentId)} onChange={() => alternar(e.shipmentId)} onClick={(ev) => ev.stopPropagation()} aria-label={`Importar ${e.shipmentId}`} />
                  </td>
                  <td className={cx(TABLA.celda, 'max-w-[280px] truncate text-[var(--ls-t1)]')}>
                    {e.nombre ?? '—'}
                    {variosMercados && <span className="ml-2 text-[11px] text-[var(--ls-t4)]">{e.mercadoNombre}</span>}
                    {errores[e.shipmentId] && (
                      <span className="mt-[2px] flex items-center gap-1 text-[11px]" style={{ color: COLOR_ESTADO.rojo }}>
                        <AlertTriangle className="h-3 w-3" /> {errores[e.shipmentId]}
                      </span>
                    )}
                  </td>
                  <td className={cx(TABLA.celda, 'font-mono text-[11.5px] text-[var(--ls-t3)]')}>{e.shipmentId}</td>
                  <td className={cx(TABLA.celda, 'text-[var(--ls-t2)]')}>{ESTADO_INBOUND_TEXTO[e.estado]?.texto ?? e.estado}</td>
                  <td className={cx(TABLA.celda, 'tabular-nums text-[var(--ls-t3)]')}>{e.diaCreacion ? fecha(e.diaCreacion) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datos && !datos.sinConexion && (
        <div className="flex items-center justify-between text-[11.5px] text-[var(--ls-t4)]">
          <span>{datos.comprobadoAt ? `Mirado en Amazon a las ${new Date(datos.comprobadoAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          <button type="button" onClick={() => void cargar(true)} disabled={cargando || importando !== null} className="inline-flex items-center gap-1 text-[var(--ls-t3)] hover:text-[var(--ls-t1)] disabled:opacity-50">
            <RefreshCw className={cx('h-3 w-3', cargando && 'animate-spin')} /> Volver a mirar en Amazon
          </button>
        </div>
      )}
    </Dialogo>
  )
}
