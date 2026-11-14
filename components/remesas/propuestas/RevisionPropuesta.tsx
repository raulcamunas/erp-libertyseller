'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ClipboardCheck, MessageSquare, RotateCcw, Send, Sparkles, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion, Insignia, Tarjeta } from '@/components/ui-ls'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { TEXTO_PUNTO, diferenciaDe, ordenarParaRevision, puntoDePropuesta, resumirDiferencias, type LineaDePropuesta } from '@/lib/fba/propuesta-cliente'
import { cx } from '../comun/ui'

/**
 * LA REVISIÓN DE LA PROPUESTA: LO QUE PROPUSIMOS FRENTE A LO QUE QUIERE EL CLIENTE.
 *
 * Cuando el cliente toca la propuesta desde su enlace (/envio/<token>) y dice «Acepto», NO se aprueba sola:
 * llega aquí, PENDIENTE DE REVISIÓN. La agencia ve cada diferencia —más, menos, fuera, nuevo— con sus
 * comentarios, y decide: aprobar (borrador → aprobada, por /estado, que además quita las líneas a 0) o
 * devolvérsela para que siga tocándola. También se puede volver a mandar la propuesta, que toma una foto
 * nueva y borra sus cambios.
 *
 * Solo para la agencia y solo en borrador. Sin la migración 309 no sale.
 */
export function RevisionPropuesta({ remesa, puedeEditar }: { remesa: RemesaDePanel; puedeEditar: boolean }) {
  const router = useRouter()
  const [trabajando, setTrabajando] = useState<'aprobar' | 'devolver' | 'enviar' | null>(null)
  const [confirmarEnvio, setConfirmarEnvio] = useState(false)
  const [verIguales, setVerIguales] = useState(false)
  const p = remesa.propuesta

  const lineas: LineaDePropuesta[] = useMemo(
    () =>
      remesa.lineas.map((l) => {
        const extra = p?.lineas[l.sku]
        return {
          sku: l.sku,
          nombre: l.nombre,
          variante: l.variante,
          referencia: l.referencia,
          asin: l.asin,
          unidades: l.enviadas,
          propuestas: extra ? extra.propuestas : l.enviadas,
          nueva: extra?.nueva ?? false,
          comentario: extra?.comentario ?? null,
        }
      }),
    [remesa.lineas, p]
  )
  const resumen = useMemo(() => resumirDiferencias(lineas), [lineas])
  const ordenadas = useMemo(() => ordenarParaRevision(lineas), [lineas])

  if (!p || remesa.estado !== 'borrador') return null
  const punto = puntoDePropuesta({ estado: remesa.estado, propuestaEnviadaAt: p.enviadaAt, clienteAceptoAt: p.aceptoAt })
  if (punto === 'montando') return null

  const pendiente = punto === 'pendiente_revision'
  const visibles = verIguales ? ordenadas : ordenadas.filter((l) => diferenciaDe(l).tipo !== 'igual' || l.comentario)

  async function aprobar() {
    setTrabajando('aprobar')
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasta: 'aprobada', desde: 'borrador' }),
      })
      const r = (await res.json().catch(() => null)) as { error?: string; motivos?: string[] } | null
      if (!res.ok) {
        toast.error(r?.motivos?.join('\n') ?? r?.error ?? 'No se ha podido aprobar')
        return
      }
      toast.success('Propuesta aprobada: el cliente ya puede descargar las etiquetas desde su enlace.')
      router.refresh()
    } finally {
      setTrabajando(null)
    }
  }

  async function accion(que: 'devolver' | 'enviar') {
    setTrabajando(que)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/propuesta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: que }) })
      const r = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(r?.error ?? 'No se ha podido hacer')
        return
      }
      toast.success(que === 'devolver' ? 'Devuelta: el cliente puede seguir tocándola desde su enlace.' : 'Propuesta mandada otra vez con lo que hay ahora.')
      router.refresh()
    } finally {
      setTrabajando(null)
    }
  }

  return (
    <Tarjeta
      variante={pendiente ? 'destacada' : 'normal'}
      acento="remesas"
      icono={pendiente ? ClipboardCheck : Sparkles}
      titulo={pendiente ? 'El cliente ha aceptado: revisa y aprueba' : 'La propuesta está con el cliente'}
      subtitulo={TEXTO_PUNTO[punto].largo}
      acciones={<Insignia tono={pendiente ? 'naranja' : 'cian'} vivo={pendiente}>{TEXTO_PUNTO[punto].corto}</Insignia>}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato rotulo="Propuesto" valor={resumen.unidadesPropuestas} />
        <Dato rotulo="El cliente" valor={resumen.unidadesCliente} resaltado={resumen.unidadesCliente !== resumen.unidadesPropuestas} />
        <Dato rotulo="Cambios" valor={resumen.mas + resumen.menos + resumen.quitadas} />
        <Dato rotulo="Nuevos" valor={resumen.nuevas} />
      </div>

      {pendiente && (p.aceptoNombre || p.comentarioCliente) && (
        <div className="mt-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2.5 text-[13px] text-[var(--ls-t2)]">
          {p.aceptoNombre && (
            <p>
              Aceptado por <strong className="text-[var(--ls-t1)]">{p.aceptoNombre}</strong>
              {p.aceptoAt ? ` el ${new Date(p.aceptoAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          )}
          {p.comentarioCliente && (
            <p className="mt-1 flex items-start gap-1.5">
              <MessageSquare className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--ls-mod-remesas)]" />
              {p.comentarioCliente}
            </p>
          )}
        </div>
      )}

      {/* Las diferencias: primero lo nuevo y lo quitado; lo que sigue igual, plegado */}
      <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--ls-linea)]">
        <div className="hidden grid-cols-[minmax(0,1fr)_80px_80px_88px] gap-3 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--ls-t4)] sm:grid">
          <span>Producto</span>
          <span className="text-right">Propuesto</span>
          <span className="text-right">Cliente</span>
          <span className="text-right">Diferencia</span>
        </div>
        {visibles.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-[var(--ls-t3)]">El cliente no ha cambiado nada de lo propuesto.</p>
        ) : (
          <ul className="max-h-[360px] divide-y divide-[var(--ls-linea)] overflow-y-auto">
            {visibles.map((l) => {
              const d = diferenciaDe(l)
              return (
                <li key={l.sku} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_80px_80px_88px] sm:items-center">
                  <div className="min-w-0">
                    <p className={cx('truncate text-[13px]', d.tipo === 'quitada' ? 'text-[var(--ls-t4)] line-through' : 'text-[var(--ls-t1)]')} title={l.nombre ?? l.sku}>
                      {l.nueva && <span className="mr-1.5 rounded-full bg-[var(--ls-mod-remesas)] px-1.5 py-[1px] text-[10px] font-bold uppercase text-[var(--ls-fondo)]">Nuevo</span>}
                      {l.nombre ?? l.sku}
                    </p>
                    <p className="truncate font-mono text-[11px] text-[var(--ls-t4)]">{l.sku}{l.variante ? ` · ${l.variante}` : ''}</p>
                    {l.comentario && (
                      <p className="mt-0.5 flex items-start gap-1 text-[12px] text-[var(--ls-t2)]">
                        <MessageSquare className="mt-[2px] h-3 w-3 shrink-0 text-[var(--ls-mod-remesas)]" />
                        {l.comentario}
                      </p>
                    )}
                  </div>
                  <span className="hidden text-right text-[13px] tabular-nums text-[var(--ls-t3)] sm:block">{l.propuestas ?? '—'}</span>
                  <span className="hidden text-right text-[13px] font-semibold tabular-nums text-[var(--ls-t1)] sm:block">{l.unidades}</span>
                  <span className="text-right">
                    <span className="mr-2 text-[12px] tabular-nums text-[var(--ls-t3)] sm:hidden">
                      {l.propuestas ?? '—'} → <strong className="text-[var(--ls-t1)]">{l.unidades}</strong>
                    </span>
                    <InsigniaDiferencia tipo={d.tipo} delta={d.delta} />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {ordenadas.length !== visibles.length || verIguales ? (
          <button type="button" onClick={() => setVerIguales((v) => !v)} className="w-full border-t border-[var(--ls-linea)] px-3 py-2 text-left text-[12.5px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
            {verIguales ? 'Ocultar lo que sigue igual' : `Ver también las ${ordenadas.length - visibles.length} que siguen igual`}
          </button>
        ) : null}
      </div>

      {puedeEditar && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {pendiente && (
            <Boton variante="primario" icono={CheckCircle2} cargando={trabajando === 'aprobar'} disabled={trabajando !== null || resumen.unidadesCliente === 0} onClick={() => void aprobar()}>
              Aprobar lo que pide el cliente
            </Boton>
          )}
          {pendiente && (
            <Boton variante="secundario" icono={Undo2} cargando={trabajando === 'devolver'} disabled={trabajando !== null} onClick={() => void accion('devolver')}>
              Devolvérsela
            </Boton>
          )}
          <Boton variante="fantasma" icono={pendiente ? RotateCcw : Send} disabled={trabajando !== null} onClick={() => setConfirmarEnvio(true)}>
            Volver a mandar la propuesta
          </Boton>
        </div>
      )}

      <Confirmacion
        abierto={confirmarEnvio}
        onCambio={setConfirmarEnvio}
        titulo="¿Volver a mandar la propuesta?"
        descripcion="Se toma una foto nueva con lo que hay ahora como «Propuesto» y se borra el «Acepto» del cliente. Sus cambios pasan a ser la propuesta."
        textoConfirmar="Mandar otra vez"
        palabra={null}
        tono="normal"
        onConfirmar={() => accion('enviar')}
      />
    </Tarjeta>
  )
}

function Dato({ rotulo, valor, resaltado }: { rotulo: string; valor: number; resaltado?: boolean }) {
  return (
    <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
      <p className="text-[11.5px] text-[var(--ls-t3)]">{rotulo}</p>
      <p className={cx('text-[20px] font-semibold tabular-nums leading-tight', resaltado ? 'text-[var(--ls-mod-remesas)]' : 'text-[var(--ls-t1)]')}>{valor.toLocaleString('es-ES')}</p>
    </div>
  )
}

function InsigniaDiferencia({ tipo, delta }: { tipo: ReturnType<typeof diferenciaDe>['tipo']; delta: number }) {
  if (tipo === 'igual') return <span className="text-[12px] text-[var(--ls-t4)]">=</span>
  const tono = tipo === 'mas' ? 'verde' : tipo === 'menos' ? 'ambar' : tipo === 'quitada' ? 'rojo' : 'cian'
  const texto = tipo === 'quitada' ? 'Fuera' : tipo === 'nueva' ? 'Nuevo' : `${delta > 0 ? '+' : ''}${delta.toLocaleString('es-ES')}`
  return <Insignia tono={tono}>{texto}</Insignia>
}
