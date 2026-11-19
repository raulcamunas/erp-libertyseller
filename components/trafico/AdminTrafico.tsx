'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, ExternalLink, KeyRound, Loader2, Plus, Power, Shapes } from 'lucide-react'
import { toast } from 'sonner'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import type { EnlaceParaAdmin } from '@/lib/trafico/servidor'

/**
 * LOS ENLACES DE TRÁFICO PARA CLIENTES (solo administradores). Crear el enlace de un cliente y país, ver y cambiar su clave (se enseña UNA vez: no se guarda en claro),
 * desactivarlo, ver cómo va la lectura del histórico y decir qué ASIN forman cada juego.
 */

const nombreDePais = (id: string) => AMAZON_MARKETPLACES.find((m) => m.id === id)?.label ?? id
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' }) : '—')
const CAMPO = 'h-9 rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]'
const BOTON = 'inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[var(--ls-linea)] px-2.5 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-50'

async function pedir<T>(url: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(url, cuerpo === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`)
  return j as T
}

function Copiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [hecho, setHecho] = useState(false)
  return (
    <button
      type="button"
      className={BOTON}
      onClick={async () => {
        await navigator.clipboard.writeText(texto)
        setHecho(true)
        setTimeout(() => setHecho(false), 1500)
      }}
    >
      {hecho ? <Check className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" /> : <Copy className="h-3.5 w-3.5" />} {etiqueta}
    </button>
  )
}

export function AdminTrafico() {
  const [datos, setDatos] = useState<{ disponible: boolean; enlaces: EnlaceParaAdmin[]; clientes: Array<{ id: string; nombre: string; marketplaces: string[] }> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState({ tipo: 'trafico' as 'trafico' | 'stock', clientId: '', marketplaceId: '', titulo: '', desde: '2025-08-01' })
  const [creando, setCreando] = useState(false)
  // La clave recién creada o cambiada: se enseña una vez
  const [claveVisible, setClaveVisible] = useState<{ id: string; clave: string } | null>(null)
  const [juegosDe, setJuegosDe] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedir('/api/trafico/admin'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los enlaces.')
    }
  }, [])
  useEffect(() => {
    void cargar()
    const t = setInterval(() => void cargar(), 60_000)
    return () => clearInterval(t)
  }, [cargar])

  const origen = typeof window !== 'undefined' ? window.location.origin : ''
  const cliente = datos?.clientes.find((c) => c.id === nuevo.clientId)

  const crear = async () => {
    setCreando(true)
    try {
      const r = await pedir<{ id: string; token: string; clave: string }>('/api/trafico/admin', { accion: 'crear', ...nuevo, titulo: nuevo.titulo || (nuevo.tipo === 'stock' ? '' : `${cliente?.nombre ?? ''} ${nombreDePais(nuevo.marketplaceId)}`.trim()) })
      setClaveVisible({ id: r.id, clave: r.clave })
      setNuevo({ tipo: 'trafico', clientId: '', marketplaceId: '', titulo: '', desde: '2025-08-01' })
      toast.success(nuevo.tipo === 'stock' ? 'Enlace del auditor de stock creado' : 'Enlace creado: el histórico se empieza a leer en un par de minutos')
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear')
    } finally {
      setCreando(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 p-4 sm:p-6">
      <header>
        <h1 className="text-[22px] font-semibold text-[var(--ls-t1)]">Tráfico para clientes</h1>
        <p className="mt-1 max-w-[760px] text-[13px] text-[var(--ls-t3)]">
          Una página con enlace y clave donde el cliente (o su agencia) ve sus sesiones, unidades, conversión y Buy Box por juego, por semana, mes o las fechas que quiera, y se descarga el Excel. Los datos
          salen del informe de Ventas y tráfico de Seller Central y se leen solos cada día. No enseña nada de publicidad.
        </p>
      </header>

      {error && <p className="flex items-center gap-2 text-[13px] text-[var(--ls-e-rojo)]"><AlertCircle className="h-4 w-4" /> {error}</p>}
      {datos && !datos.disponible && <p className="rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-acc-suave)] px-3 py-2 text-[13px] text-[var(--ls-t1)]">Falta lanzar la migración 322 en Supabase.</p>}

      <section className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]"><Plus className="h-4 w-4" /> Enlace nuevo</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
            Qué enseña
            <select className={CAMPO} value={nuevo.tipo} onChange={(e) => setNuevo((n) => ({ ...n, tipo: e.target.value as 'trafico' | 'stock' }))}>
              <option value="trafico">Tráfico y conversión</option>
              <option value="stock">Auditor de stock (ShoesF)</option>
            </select>
          </label>
          {nuevo.tipo === 'trafico' && <>
          <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
            Cliente
            <select className={CAMPO} value={nuevo.clientId} onChange={(e) => { const c = datos?.clientes.find((x) => x.id === e.target.value); setNuevo((n) => ({ ...n, clientId: e.target.value, marketplaceId: c?.marketplaces.includes('A1RKKUPIHCS9HS') ? 'A1RKKUPIHCS9HS' : (c?.marketplaces[0] ?? '') })) }}>
              <option value="">Elige…</option>
              {datos?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
            País
            <select className={CAMPO} value={nuevo.marketplaceId} onChange={(e) => setNuevo((n) => ({ ...n, marketplaceId: e.target.value }))} disabled={!cliente}>
              {(cliente?.marketplaces ?? []).map((m) => <option key={m} value={m}>{nombreDePais(m)}</option>)}
            </select>
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
            Título (lo ve el cliente)
            <input className={CAMPO} value={nuevo.titulo} onChange={(e) => setNuevo((n) => ({ ...n, titulo: e.target.value }))} placeholder={cliente ? `${cliente.nombre} ${nombreDePais(nuevo.marketplaceId)}` : 'Creative Toys España'} maxLength={120} />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
            Histórico desde
            <input type="date" className={CAMPO} value={nuevo.desde} onChange={(e) => setNuevo((n) => ({ ...n, desde: e.target.value }))} />
          </label>
          </>}
          {nuevo.tipo === 'stock' && (
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
              Título (lo ve el cliente)
              <input className={CAMPO} value={nuevo.titulo} onChange={(e) => setNuevo((n) => ({ ...n, titulo: e.target.value }))} placeholder="ShoesF · stock Amazon y tienda" maxLength={120} />
            </label>
          )}
          <button type="button" disabled={(nuevo.tipo === 'trafico' && (!nuevo.clientId || !nuevo.marketplaceId)) || creando} onClick={() => void crear()} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[var(--ls-acc)] px-3 text-[13px] font-semibold text-white disabled:opacity-50">
            {creando && <Loader2 className="h-4 w-4 animate-spin" />} Crear enlace
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--ls-t4)]">{nuevo.tipo === 'stock' ? 'El auditor de stock enseña lo que ya guarda el ERP cada 20 minutos (con stock, entran, salen, precios y el cruce con PrestaShop), solo para leer.' : <>El histórico se lee día a día de Amazon (unos 30 días por hora): un año tarda una tarde. Lo reciente sale primero.</>}</p>
      </section>

      {datos?.enlaces.map((e) => {
        const url = `${origen}/${e.tipo === 'stock' ? 'stock' : 'trafico'}/${e.token}`
        const total = e.lectura.hechos + e.lectura.faltan
        return (
          <section key={e.id} className={`rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 ${e.activo ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-[var(--ls-t1)]">{e.titulo} {!e.activo && <span className="ml-1 text-[12px] font-normal text-[var(--ls-t4)]">· desactivado</span>}</h3>
                <p className="mt-0.5 text-[12px] text-[var(--ls-t3)]">{e.tipo === 'stock' ? 'Auditor de stock' : 'Tráfico y conversión'} · {e.cliente} · {nombreDePais(e.marketplace_id)} · creado {fecha(e.creado_en)} · {e.accesos} entradas{e.ultimo_acceso ? `, la última ${fecha(e.ultimo_acceso)}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Copiar texto={url} etiqueta="Copiar enlace" />
                <a href={url} target="_blank" rel="noreferrer" className={BOTON}><ExternalLink className="h-3.5 w-3.5" /> Abrir</a>
                <button type="button" className={BOTON} onClick={async () => { if (!window.confirm('¿Clave nueva? La anterior deja de valer y quien esté dentro tendrá que poner la nueva.')) return; try { const r = await pedir<{ clave: string }>('/api/trafico/admin', { accion: 'clave', id: e.id }); setClaveVisible({ id: e.id, clave: r.clave }) } catch (err) { toast.error(err instanceof Error ? err.message : 'No se ha podido') } }}><KeyRound className="h-3.5 w-3.5" /> Clave nueva</button>
                {e.tipo !== 'stock' && <button type="button" className={BOTON} onClick={() => setJuegosDe(juegosDe === e.id ? null : e.id)}><Shapes className="h-3.5 w-3.5" /> Juegos ({e.juegos})</button>}
                <button type="button" className={BOTON} onClick={async () => { try { await pedir('/api/trafico/admin', { accion: 'activar', id: e.id, activo: !e.activo }); await cargar() } catch (err) { toast.error(err instanceof Error ? err.message : 'No se ha podido') } }}><Power className="h-3.5 w-3.5" /> {e.activo ? 'Desactivar' : 'Activar'}</button>
              </div>
            </div>

            {claveVisible?.id === e.id && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] px-3 py-2.5">
                <KeyRound className="h-4 w-4 text-[var(--ls-acc)]" />
                <span className="text-[13px] text-[var(--ls-t1)]">Clave: <b className="font-mono text-[15px] tracking-wide">{claveVisible.clave}</b></span>
                <Copiar texto={claveVisible.clave} etiqueta="Copiar clave" />
                <span className="text-[11.5px] text-[var(--ls-t3)]">Apúntala o mándala ahora: no se guarda y no se puede volver a ver (si se pierde, «Clave nueva»).</span>
                <button type="button" className="ml-auto text-[12px] text-[var(--ls-t3)] underline" onClick={() => setClaveVisible(null)}>Ocultar</button>
              </div>
            )}

            {e.tipo !== 'stock' && <>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-[var(--ls-t2)]">
              <span>Leídos de Amazon: <b className="tabular-nums">{e.lectura.hechos}</b> de {total} días{e.lectura.faltan > 0 ? ` (faltan ${e.lectura.faltan})` : ''}</span>
              {e.lectura.pedidos > 0 && <span className="text-[var(--ls-t3)]">{e.lectura.pedidos} preparándose en Amazon</span>}
              <span className="text-[var(--ls-t3)]">Datos hasta el {e.lectura.ultimoDia ?? '—'}</span>
              {e.lectura.errores > 0 && <span className="text-[var(--ls-e-rojo)]">{e.lectura.errores} días con error{e.lectura.ultimoError ? `: ${e.lectura.ultimoError}` : ''}</span>}
            </div>
            {total > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                <div className="h-full rounded-full bg-[var(--ls-acc)]" style={{ width: `${Math.round((e.lectura.hechos / total) * 100)}%` }} />
              </div>
            )}
            </>}

            {juegosDe === e.id && <EditorDeJuegos id={e.id} alGuardar={() => void cargar()} />}
          </section>
        )
      })}
      {datos && datos.enlaces.length === 0 && datos.disponible && <p className="text-[13px] text-[var(--ls-t3)]">Todavía no hay ningún enlace.</p>}
    </div>
  )
}

/** Qué ASIN forman cada juego: un ASIN por fila con su juego. Los que no se han tocado llevan el nombre corto de su listing */
function EditorDeJuegos({ id, alGuardar }: { id: string; alGuardar: () => void }) {
  const [filas, setFilas] = useState<Array<{ asin: string; juego: string; producto: string | null; aMano: boolean; sesiones: number }> | null>(null)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => {
    pedir<{ juegos: NonNullable<typeof filas> }>(`/api/trafico/admin?juegos=${id}`)
      .then((r) => setFilas(r.juegos))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'No se han podido leer'))
  }, [id])
  if (!filas) return <div className="mt-3"><Loader2 className="h-4 w-4 animate-spin text-[var(--ls-t3)]" /></div>
  const nombres = [...new Set(filas.map((f) => f.juego))].sort((a, b) => a.localeCompare(b, 'es'))
  return (
    <div className="mt-4 border-t border-[var(--ls-linea)] pt-3">
      <p className="mb-2 text-[12px] text-[var(--ls-t3)]">Los ASIN con el mismo nombre de juego se suman (ediciones en otros idiomas, colores…). Escribe el nombre igual en todos los que tengan que ir juntos.</p>
      <datalist id={`juegos-${id}`}>{nombres.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="max-h-[420px] overflow-y-auto rounded-[10px] border border-[var(--ls-linea)]">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-[var(--ls-sup2)] text-left text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
            <tr><th className="px-2 py-1.5">ASIN</th><th className="px-2 py-1.5">Juego</th><th className="px-2 py-1.5">Producto</th><th className="px-2 py-1.5 text-right">Sesiones</th></tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.asin} className="border-t border-[var(--ls-linea)]">
                <td className="px-2 py-1 font-mono text-[var(--ls-t3)]">{f.asin}</td>
                <td className="px-2 py-1"><input list={`juegos-${id}`} value={f.juego} onChange={(e) => setFilas((x) => x && x.map((y, j) => (j === i ? { ...y, juego: e.target.value, aMano: true } : y)))} className={`${CAMPO} h-7 w-full min-w-[220px] ${f.aMano ? '' : 'text-[var(--ls-t3)]'}`} /></td>
                <td className="max-w-[360px] truncate px-2 py-1 text-[var(--ls-t3)]" title={f.producto ?? ''}>{f.producto ?? '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums text-[var(--ls-t3)]">{f.sesiones.toLocaleString('es-ES')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={guardando}
        onClick={async () => {
          setGuardando(true)
          try {
            const r = await pedir<{ guardados: number }>('/api/trafico/admin', { accion: 'juegos', id, filas: filas.map((f) => ({ asin: f.asin, juego: f.juego, producto: f.producto })) })
            toast.success(`${r.guardados} ASIN guardados`)
            alGuardar()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
          } finally {
            setGuardando(false)
          }
        }}
        className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[var(--ls-acc)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
      >
        {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar los juegos
      </button>
    </div>
  )
}
