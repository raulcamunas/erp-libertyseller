'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, Plus, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { NOMBRE_DEL_INFORME, periodoEnTexto, vocabularioInterno, type LineaEjecutada } from '@/lib/cuentas/informe'
import type { InformeGuardado } from '@/lib/cuentas/informes'
import { CAJA } from '@/components/marketing-test/piezas'
import { Cargando } from '@/components/plataforma/comun'
import { DocumentoInforme } from './DocumentoInforme'
import { Nota } from './piezas'

interface Respuesta {
  informe: InformeGuardado
  slug: string | null
  url: string
  para: string
  asunto: string
  firma: string
}

const CAMPO = 'w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 py-[6px] text-[13px] text-[var(--ls-t1)]'
const BOTON = 'inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-[var(--ls-linea)] px-3 text-[12px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] disabled:opacity-45'
const PRIMARIO = 'inline-flex h-[32px] items-center gap-[6px] rounded-[8px] border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-45'

/**
 * EL BORRADOR DE UN INFORME AL CLIENTE. A la izquierda lo que se edita (la lectura que propuso la IA, lo hecho fuera del ERP y el correo); a la
 * derecha el informe tal y como lo verá el cliente, al momento. Enviar lo manda desde tu buzón con el enlace y marca el paso del ciclo.
 */
export function EditorDeInforme({ id }: { id: string }) {
  const [r, setR] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [lectura, setLectura] = useState('')
  const [extra, setExtra] = useState<LineaEjecutada[]>([])
  const [para, setPara] = useState('')
  const [asunto, setAsunto] = useState('')
  const [saludo, setSaludo] = useState('Hola,')
  const [firma, setFirma] = useState('')
  const [sucio, setSucio] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/cuentas/informe?id=${id}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'No se ha podido leer el informe.')
      setR(j)
      setLectura(j.informe.lectura)
      setExtra(j.informe.extra ?? [])
      setPara(j.para ?? '')
      setAsunto(j.asunto)
      setFirma(j.firma)
      setSucio(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido leer el informe.')
    }
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  const llamar = async (cuerpo: Record<string, unknown>, clave: string, recargar = true) => {
    setOcupado(clave)
    setError(null)
    try {
      const res = await fetch('/api/cuentas/informe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...cuerpo }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'No se ha podido completar.')
      if (recargar) await cargar()
      return j
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido completar.')
      return null
    } finally {
      setOcupado(null)
    }
  }

  const guardar = () => llamar({ accion: 'guardar', lectura, extra: extra.filter((x) => x.accion.trim()) }, 'guardar')
  const internas = useMemo(() => vocabularioInterno(lectura), [lectura])
  const enviado = r?.informe.estado === 'enviado'

  const enviar = async () => {
    if (sucio) {
      const ok = await llamar({ accion: 'guardar', lectura, extra: extra.filter((x) => x.accion.trim()) }, 'enviar', false)
      if (!ok) return
    }
    if (!window.confirm(`Se va a enviar el informe a ${para} desde tu correo. ¿Enviar?`)) return
    const j = await llamar({ accion: 'enviar', para, asunto, saludo, firma }, 'enviar')
    if (j?.ok) setHecho(`Enviado a ${j.para}.`)
  }

  const borrar = async () => {
    if (!window.confirm('¿Borrar este borrador? No se puede deshacer.')) return
    setOcupado('borrar')
    const res = await fetch(`/api/cuentas/informe?id=${id}`, { method: 'DELETE' })
    setOcupado(null)
    if (res.ok) window.location.href = r?.slug ? `/dashboard/cuentas?c=${r.slug}` : '/dashboard/cuentas'
    else setError('No se ha podido borrar.')
  }

  if (!r) return <div className="p-4">{error ? <Nota tono="rojo">{error}</Nota> : <Cargando texto="Leyendo el informe…" />}</div>
  const inf = r.informe

  return (
    <div className="mx-auto flex w-full max-w-[1500px] min-w-0 flex-col gap-4 px-1 pb-10">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={r.slug ? `/dashboard/cuentas?c=${r.slug}` : '/dashboard/cuentas'} className={BOTON}>
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a la cuenta
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] font-semibold text-[var(--ls-t1)]">
            {NOMBRE_DEL_INFORME[inf.tipo]} · {inf.datos.cliente}
          </h1>
          <p className="text-[12px] text-[var(--ls-t3)]">
            {periodoEnTexto(inf.desde, inf.hasta)} · {enviado ? `enviado el ${new Date(inf.enviadoAt as string).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} a ${inf.enviadoA}` : 'borrador'}
          </p>
        </div>
        {enviado && (
          <button type="button" className={BOTON} onClick={() => navigator.clipboard.writeText(r.url)}>
            <Copy className="h-3.5 w-3.5" /> Copiar el enlace del cliente
          </button>
        )}
      </header>

      {error && <Nota tono="rojo">{error}</Nota>}
      {hecho && <Nota tono="azul">{hecho}</Nota>}

      <div className="grid min-w-0 gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        {/* Lo que se edita */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className={CAJA.base}>
            <div className={CAJA.cabecera}>
              <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">1 · La lectura del periodo</span>
              {!enviado && (
                <button type="button" className={BOTON} disabled={!!ocupado} onClick={() => llamar({ accion: 'lectura-ia' }, 'ia')}>
                  <Sparkles className={`h-3.5 w-3.5 ${ocupado === 'ia' ? 'animate-pulse' : ''}`} /> Otra propuesta de la IA
                </button>
              )}
            </div>
            <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
              <p className="text-[12px] leading-[1.5] text-[var(--ls-t3)]">
                {inf.lecturaIa ? 'La ha propuesto la IA con las cifras del informe.' : 'Son las cifras en frases (la IA no ha contestado).'} Léela entera, corrige lo que no sea cierto y añade lo que sabes tú: lo hablado con el cliente, lo hecho fuera del ERP, lo que no depende de la publicidad (precio, stock, competencia). Nada de promesas ni de planes.
              </p>
              <textarea value={lectura} disabled={enviado} onChange={(e) => (setLectura(e.target.value), setSucio(true))} rows={11} className={`${CAMPO} resize-y leading-[1.55]`} />
              {internas.length > 0 && <Nota tono="ambar">El cliente no entiende «{internas.join('», «')}»: cámbialo por palabras normales.</Nota>}
            </div>
          </section>

          <section className={CAJA.base}>
            <div className={CAJA.cabecera}>
              <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">2 · Lo hecho fuera del ERP</span>
              {!enviado && (
                <button type="button" className={BOTON} onClick={() => (setExtra([...extra, { accion: '', cantidad: 0, criterio: '' }]), setSucio(true))}>
                  <Plus className="h-3.5 w-3.5" /> Añadir
                </button>
              )}
            </div>
            <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
              <p className="text-[12px] text-[var(--ls-t3)]">
                Lo cambiado desde el ERP ya sale solo ({inf.datos.ejecutado.reduce((a, x) => a + x.cantidad, 0)} cambios). Añade aquí lo que hiciste en Seller Central o en la consola de Amazon Ads: una fila por tipo de acción, con el porqué.
              </p>
              {inf.datos.ejecutado.length === 0 && extra.filter((x) => x.accion.trim()).length === 0 && <Nota tono="ambar">No hay ningún cambio apuntado: si no añades lo que hiciste, el informe no tendrá la sección «Lo que hemos hecho».</Nota>}
              {extra.map((x, i) => (
                <div key={i} className="grid items-start gap-2" style={{ gridTemplateColumns: 'minmax(0,2fr) 70px minmax(0,3fr) 28px' }}>
                  <input className={CAMPO} disabled={enviado} placeholder="Acción (ej.: Imágenes nuevas)" value={x.accion} onChange={(e) => (setExtra(extra.map((y, j) => (j === i ? { ...y, accion: e.target.value } : y))), setSucio(true))} />
                  <input className={CAMPO} disabled={enviado} type="number" min={0} value={x.cantidad || ''} placeholder="Nº" onChange={(e) => (setExtra(extra.map((y, j) => (j === i ? { ...y, cantidad: Number(e.target.value) } : y))), setSucio(true))} />
                  <input className={CAMPO} disabled={enviado} placeholder="Por qué" value={x.criterio} onChange={(e) => (setExtra(extra.map((y, j) => (j === i ? { ...y, criterio: e.target.value } : y))), setSucio(true))} />
                  {!enviado && (
                    <button type="button" aria-label="Quitar" className="mt-[6px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]" onClick={() => (setExtra(extra.filter((_, j) => j !== i)), setSucio(true))}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {!enviado && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={PRIMARIO} disabled={!sucio || !!ocupado} onClick={guardar}>
                {sucio ? 'Guardar cambios' : 'Guardado'}
              </button>
              <button type="button" className={BOTON} disabled={!!ocupado} onClick={() => llamar({ accion: 'recalcular' }, 'recalcular')} title="Vuelve a sacar las cifras del periodo (la lectura no se toca)">
                <RefreshCw className={`h-3.5 w-3.5 ${ocupado === 'recalcular' ? 'animate-spin' : ''}`} /> Volver a sacar las cifras
              </button>
              <button type="button" className={BOTON} disabled={!!ocupado} onClick={borrar}>
                <Trash2 className="h-3.5 w-3.5" /> Borrar borrador
              </button>
            </div>
          )}

          <section className={CAJA.base}>
            <div className={CAJA.cabecera}>
              <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">3 · Enviar al cliente</span>
            </div>
            <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
              <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
                Para (separa varias direcciones con comas)
                <input className={CAMPO} disabled={enviado} value={para} onChange={(e) => setPara(e.target.value)} placeholder="cliente@empresa.com" />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
                Asunto
                <input className={CAMPO} disabled={enviado} value={asunto} onChange={(e) => setAsunto(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
                Saludo
                <input className={CAMPO} disabled={enviado} value={saludo} onChange={(e) => setSaludo(e.target.value)} placeholder="Hola, Ana:" />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
                Firma
                <textarea className={`${CAMPO} resize-y`} rows={3} disabled={enviado} value={firma} onChange={(e) => setFirma(e.target.value)} />
              </label>
              <p className="text-[12px] leading-[1.5] text-[var(--ls-t3)]">
                Sale desde tu correo: el saludo, la lectura y un botón al informe (el cliente lo puede guardar en PDF). Al enviarlo se marca hecho el paso del informe de esta semana.
              </p>
              {!enviado && (
                <div>
                  <button type="button" className={PRIMARIO} disabled={!!ocupado || !para.trim() || !lectura.trim() || internas.length > 0} onClick={enviar}>
                    <Send className="h-3.5 w-3.5" /> {ocupado === 'enviar' ? 'Enviando…' : 'Enviar al cliente'}
                  </button>
                </div>
              )}
              {enviado && (
                <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.verde }}>
                  Enviado. Este informe ya no se puede cambiar.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Cómo lo verá el cliente */}
        <div className="min-w-0 overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[#EDE6DC] p-3">
          <div className="mb-2 text-[11.5px] font-medium text-[#5E5852]">Así lo verá el cliente</div>
          <DocumentoInforme d={inf.datos} lectura={lectura} extra={extra} />
        </div>
      </div>
    </div>
  )
}
