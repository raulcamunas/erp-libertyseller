'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { BOTON, CAMPO, TIPO } from '@/lib/estilo/denso'
import { cx } from '@/components/remesas/comun/ui'

interface EstadoTope {
  sku: string
  unidades: number
  desde: string
  hasta: string
  nota: string | null
  vigente: boolean
  amazon: number | null
  pcc: number | null
  quedan: number | null
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const finDeMes = () => {
  const [a, m] = hoy().split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}
const fecha = (d: string) => d.split('-').reverse().join('/')

/** Topes de unidades por producto: en Amazon y en PcComponentes juntos no se publica más de lo que queda del tope */
export function TopesDeUnidades() {
  const [topes, setTopes] = useState<EstadoTope[] | null>(null)
  const [form, setForm] = useState({ sku: '', unidades: '5', desde: hoy(), hasta: finDeMes(), nota: '' })
  const [guardando, setGuardando] = useState(false)

  const leer = useCallback(async () => {
    const r = await fetch('/api/entrais/topes', { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (r.ok) setTopes(j.topes)
    else toast.error(j?.error ?? 'No se pudieron leer los topes')
  }, [])
  useEffect(() => { void leer() }, [leer])

  const enviar = async (cuerpo: Record<string, unknown>) => {
    setGuardando(true)
    const r = await fetch('/api/entrais/topes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
    const j = await r.json().catch(() => null)
    setGuardando(false)
    if (!r.ok) return toast.error(j?.error ?? 'No se ha podido guardar')
    toast.success('Guardado. Se aplica en la siguiente pasada de stock de Amazon y de PcComponentes')
    await leer()
    return true
  }

  return (
    <div className="max-w-[980px] space-y-4">
      <div>
        <h2 className={TIPO.xl}>Topes de unidades</h2>
        <p className="mt-1 text-[12px] leading-[1.55] text-[var(--ls-t3)]">
          Para ofertas del distribuidor limitadas («precio especial limitado a 5 unidades»). Entre las dos fechas, el stock que se publica en <b>Amazon y en PcComponentes</b> nunca pasa de
          «tope − lo vendido en los dos canales desde la fecha de inicio». Al llegar al tope se publica a 0, y pasada la fecha de fin vuelve solo al stock del proveedor.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await enviar({ ...form, unidades: Number(form.unidades) })) setForm((f) => ({ ...f, sku: '', nota: '' }))
        }}
      >
        <label className={CAMPO.contenedor}><span className={CAMPO.etiqueta}>Referencia (SKU)</span><input className={CAMPO.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="48087" required /></label>
        <label className={CAMPO.contenedor}><span className={CAMPO.etiqueta}>Unidades máximas</span><input className={cx(CAMPO.input, CAMPO.numero)} type="number" min={0} step={1} value={form.unidades} onChange={(e) => setForm({ ...form, unidades: e.target.value })} required /></label>
        <label className={CAMPO.contenedor}><span className={CAMPO.etiqueta}>Desde</span><input className={CAMPO.input} type="date" value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} required /></label>
        <label className={CAMPO.contenedor}><span className={CAMPO.etiqueta}>Hasta (incluido)</span><input className={CAMPO.input} type="date" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} required /></label>
        <label className={cx(CAMPO.contenedor, 'col-span-full sm:col-span-2')}><span className={CAMPO.etiqueta}>Nota</span><input className={CAMPO.input} value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} placeholder="Oferta Black Friday del distribuidor" /></label>
        <div className="flex items-end">
          <button type="submit" disabled={guardando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Poner tope
          </button>
        </div>
      </form>

      {topes === null ? (
        <div className="flex items-center gap-2 text-[12px] text-[var(--ls-t3)]"><Loader2 className="h-3 w-3 animate-spin" /> Leyendo los topes…</div>
      ) : topes.length === 0 ? (
        <p className="text-[12px] text-[var(--ls-t3)]">No hay ningún tope puesto.</p>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-[var(--ls-linea)]">
          <table className="w-full min-w-[720px] text-[12px]">
            <thead className="bg-[var(--ls-sup2)] text-[11px] text-[var(--ls-t4)]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Periodo</th>
                <th className="px-3 py-2 text-right font-semibold">Tope</th>
                <th className="px-3 py-2 text-right font-semibold">Vendidas Amazon</th>
                <th className="px-3 py-2 text-right font-semibold">Vendidas PcComp.</th>
                <th className="px-3 py-2 text-right font-semibold">Se publica como mucho</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {topes.map((t) => (
                <tr key={t.sku} className="border-t border-[var(--ls-linea)]">
                  <td className="px-3 py-2"><div className="font-medium text-[var(--ls-t1)]">{t.sku}</div>{t.nota && <div className="text-[11px] text-[var(--ls-t4)]">{t.nota}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--ls-t2)]">{fecha(t.desde)} – {fecha(t.hasta)}{!t.vigente && <span className="ml-2 rounded-[5px] bg-[var(--ls-sup2)] px-[6px] py-[1px] text-[10.5px] text-[var(--ls-t4)]">{t.hasta < hoy() ? 'Terminado' : 'Aún no empieza'}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.unidades}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.amazon ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.pcc ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: t.quedan === 0 ? '#F87171' : 'var(--ls-t1)' }}>{t.quedan === null ? 'Sin tope' : t.quedan}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" disabled={guardando} onClick={() => confirm(`¿Quitar el tope de ${t.sku}? Volverá a publicarse todo el stock del proveedor.`) && void enviar({ borrar: t.sku })} className={cx(BOTON.base, BOTON.secundario)} title="Quitar el tope"><Trash2 className="h-3 w-3" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
