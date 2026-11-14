'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, Loader2, PackagePlus, RefreshCw } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { estaVivo, ordenarColumnas, ordenarTarjetas, type ColumnaTablero } from '@/lib/fba/tablero'
import { cx } from '../comun/ui'
import { TarjetaEnvioVista } from '../envios/ListaEnvios'

/**
 * EL TABLERO DE REMESAS: una columna por cliente, con sus envíos como tarjetas — el estado de todos los FBA de un vistazo.
 *
 * Es lo primero que se ve al entrar (con más de un cliente). Cada columna enseña los envíos VIVOS de ese cliente —los que aún tienen mercancía en Amazon—, con la misma tarjeta de la lista de
 * envíos: estado, cuántas quedan, % vendido, lo que no llegó y el aviso de «se agota en N días». Los agotados están detrás de «Ver agotados» para que no tapen lo que importa. Pulsar una tarjeta abre ese
 * envío en su cliente; pulsar el nombre abre el cliente; el «+N» ámbar de la cabecera son los envíos nuevos que Amazon tiene en su cuenta y el ERP no (abre «Importar pedidos»).
 *
 * Los datos llegan de /api/fba/tablero, que el servidor guarda 3 minutos. Aquí se guarda también lo último que llegó: al volver a la pestaña se ve al instante y se actualiza detrás.
 */

interface Cargado {
  hoy: string
  columnas: ColumnaTablero[]
  en: number
}

/** Lo último que llegó, para no empezar en blanco al volver a la pestaña */
let ultimo: Cargado | null = null

export function TableroClientes({
  nuevosPorCliente,
  version,
  onAbrir,
  onImportar,
}: {
  /** Envíos nuevos de Amazon por cliente (insignia ámbar). Falta mientras se está preguntando a Amazon */
  nuevosPorCliente: Record<string, number>
  /** Sube cuando algo ha cambiado fuera (se ha importado un envío): vuelve a leer */
  version: number
  onAbrir: (clienteId: string, remesaId: string | null) => void
  onImportar: (clienteId: string) => void
}) {
  const [datos, setDatos] = useState<Cargado | null>(ultimo)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const leer = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/fba/tablero')
      const p = (await res.json().catch(() => null)) as { error?: string; hoy?: string; columnas?: ColumnaTablero[] } | null
      if (!res.ok || !p?.columnas || !p.hoy) {
        setError(p?.error ?? 'No se ha podido leer el tablero')
        return
      }
      ultimo = { hoy: p.hoy, columnas: p.columnas, en: Date.now() }
      setDatos(ultimo)
    } catch {
      setError('No se ha podido leer el tablero')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void leer()
  }, [leer, version])

  const columnas = datos ? ordenarColumnas(datos.columnas) : []

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-3 text-[12px] text-[var(--ls-t3)]">
        <span>
          Los envíos vivos de cada cliente. {datos && <>Actualizado a las {new Date(datos.en).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.</>}
        </span>
        <button type="button" onClick={() => void leer()} disabled={cargando} className="inline-flex items-center gap-1 text-[var(--ls-t3)] hover:text-[var(--ls-t1)] disabled:opacity-60">
          <RefreshCw className={cx('h-3 w-3', cargando && 'animate-spin')} />
          Actualizar
        </button>
        {error && (
          <span className="inline-flex items-center gap-1" style={{ color: COLOR_ESTADO.rojo }} role="alert">
            <AlertTriangle className="h-3 w-3" /> {error}
          </span>
        )}
      </div>

      {!datos && cargando && (
        <div className="flex flex-1 items-center justify-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Leyendo los envíos de todos los clientes…
        </div>
      )}

      {datos && (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {columnas.map((c) => (
            <Columna key={c.clienteId} columna={c} nuevos={nuevosPorCliente[c.clienteId] ?? 0} onAbrir={onAbrir} onImportar={onImportar} />
          ))}
        </div>
      )}
    </div>
  )
}

function Columna({ columna, nuevos, onAbrir, onImportar }: { columna: ColumnaTablero; nuevos: number; onAbrir: (clienteId: string, remesaId: string | null) => void; onImportar: (clienteId: string) => void }) {
  const [verAgotados, setVerAgotados] = useState(false)
  const ordenadas = ordenarTarjetas(columna.tarjetas)
  const vivas = ordenadas.filter(estaVivo)
  const agotadas = ordenadas.filter((t) => !estaVivo(t))
  const seAgota = vivas.filter((t) => t.cobertura !== null && t.cobertura < 7).length
  const sinNada = vivas.length === 0 && columna.propuestas === 0 && agotadas.length === 0
  const aviso = seAgota > 0 ? COLOR_ESTADO.rojo : vivas.some((t) => t.noLlegaron > 0) ? COLOR_ESTADO.ambar : null

  return (
    <section className={cx('flex min-h-0 w-[300px] shrink-0 flex-col rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)]', sinNada && 'opacity-60')} aria-label={`Envíos de ${columna.nombre}`}>
      <header className="shrink-0 border-b border-[var(--ls-linea)] px-[11px] py-[9px]">
        <div className="flex items-center gap-2">
          {aviso && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: aviso }} title={seAgota > 0 ? `${seAgota} envío${seAgota === 1 ? '' : 's'} se agota${seAgota === 1 ? '' : 'n'} en menos de 7 días` : 'Hay unidades que Amazon no ha dado por recibidas'} />}
          <button type="button" onClick={() => onAbrir(columna.clienteId, null)} className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-[var(--ls-t1)] hover:underline" title={`Abrir ${columna.nombre}`}>
            {columna.nombre}
          </button>
          {nuevos > 0 && columna.puedeEditar && (
            <button
              type="button"
              onClick={() => onImportar(columna.clienteId)}
              className="inline-flex h-[20px] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold"
              style={{ background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 18%, transparent)`, color: COLOR_ESTADO.ambar }}
              title={`${nuevos} envío${nuevos === 1 ? '' : 's'} en Amazon que todavía no está${nuevos === 1 ? '' : 'n'} en el ERP: importar`}
            >
              <PackagePlus className="h-3 w-3" />+{nuevos}
            </button>
          )}
        </div>
        <p className="mt-[2px] text-[11px] text-[var(--ls-t4)]">
          {vivas.length} {vivas.length === 1 ? 'vivo' : 'vivos'}
          {columna.propuestas > 0 && ` · ${columna.propuestas} ${columna.propuestas === 1 ? 'propuesta' : 'propuestas'}`}
          {agotadas.length > 0 && ` · ${agotadas.length} ${agotadas.length === 1 ? 'agotado' : 'agotados'}`}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-[6px] overflow-y-auto p-[7px]">
        {vivas.length === 0 && (
          <p className="px-2 py-6 text-center text-[11.5px] text-[var(--ls-t4)]">
            {sinNada ? 'Todavía sin envíos' : agotadas.length > 0 ? 'Nada vivo: todos agotados' : 'Sin envíos vivos'}
          </p>
        )}
        {vivas.map((t) => (
          <TarjetaEnvioVista key={t.id} datos={t} cobertura={t.cobertura} chispa={t.chispa} onClick={() => onAbrir(columna.clienteId, t.id)} />
        ))}
        {agotadas.length > 0 && (
          <>
            <button type="button" onClick={() => setVerAgotados((v) => !v)} className="flex w-full items-center justify-center gap-1 py-1 text-[11.5px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]" aria-expanded={verAgotados}>
              <ChevronDown className={cx('h-3 w-3 transition-transform', verAgotados && 'rotate-180')} />
              {verAgotados ? 'Ocultar agotados' : `Ver ${agotadas.length} ${agotadas.length === 1 ? 'agotado' : 'agotados'}`}
            </button>
            {verAgotados && agotadas.map((t) => <TarjetaEnvioVista key={t.id} datos={t} cobertura={t.cobertura} chispa={t.chispa} onClick={() => onAbrir(columna.clienteId, t.id)} />)}
          </>
        )}
      </div>
    </section>
  )
}
