'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { BOTON, CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { CLAVES_DE_ETAPA, diaALaVenta, diasValidos, medirPlazos, repartirTotal, totalDeEtapas, type EtapasDePlazo, type RemesaParaMedir } from '@/lib/fba/plazos'
import { cx } from './comun/ui'
import { fecha } from './formato'

/**
 * LOS PLAZOS DE UN CLIENTE: cuánto tarda desde que se le avisa hasta que su mercancía está a la venta en Amazon, etapa a etapa.
 *
 *   preparación   el cliente prepara y envía (desde que le avisamos)
 *   transporte    del envío al almacén de Amazon
 *   recepción     Amazon lo procesa hasta que se puede vender
 *   margen        colchón para retrasos
 *
 * La suma es el plazo de reposición con el que calculan las alertas «reponer ya / pronto»: un cliente que tarda tres semanas en enviar no se avisa igual que uno que envía en tres días.
 * Al lado de cada etapa se enseña lo que han tardado de verdad sus últimos envíos (lib/fba/plazos.ts → medirPlazos), con un botón para usarlo: es una pista, no un dato de Amazon.
 * Sin la migración 291 solo se puede guardar el total, como antes. Lo guarda app/api/fba/alertas/config.
 */

interface Guardado {
  configurado: boolean
  plazoDias: number
  antelacionDias: number
  avisar: boolean
  etapas: EtapasDePlazo | null
  sinMigrar291: boolean
}

const TEXTO: Record<keyof EtapasDePlazo, { titulo: string; ayuda: string }> = {
  preparacion: { titulo: 'Preparación del cliente', ayuda: 'Desde que le avisamos hasta que envía a Amazon: compra o fabricación, etiquetado y entrega al transportista.' },
  transporte: { titulo: 'Transporte a Amazon', ayuda: 'Del envío hasta que llega al almacén de Amazon.' },
  recepcion: { titulo: 'Procesamiento de Amazon', ayuda: 'Check-in y recepción en el almacén, hasta que se puede vender.' },
  margen: { titulo: 'Margen de error', ayuda: 'Colchón para retrasos: aduanas, huelgas, una recepción que se atasca.' },
}

export function PlazosDialog({
  clienteId,
  clienteNombre,
  remesas,
  hoy,
  onCerrar,
  onGuardado,
}: {
  clienteId: string
  clienteNombre: string
  /** Los envíos del cliente, para enseñar lo que han tardado */
  remesas: readonly RemesaParaMedir[]
  hoy: string
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [guardado, setGuardado] = useState<Guardado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [etapas, setEtapas] = useState<Record<keyof EtapasDePlazo, string>>({ preparacion: '', transporte: '', recepcion: '', margen: '' })
  const [total, setTotal] = useState('')
  const [antelacion, setAntelacion] = useState('14')
  const [avisar, setAvisar] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch(`/api/fba/alertas/config?clienteId=${clienteId}`)
      .then(async (res) => ({ res, p: (await res.json().catch(() => null)) as (Guardado & { error?: string }) | null }))
      .then(({ res, p }) => {
        if (!vivo) return
        if (!res.ok || !p) {
          setError(p?.error ?? 'No se han podido leer los plazos')
          return
        }
        setGuardado(p)
        const e = p.etapas ?? repartirTotal(p.plazoDias)
        setEtapas({ preparacion: String(e.preparacion), transporte: String(e.transporte), recepcion: String(e.recepcion), margen: String(e.margen) })
        setTotal(String(p.plazoDias))
        setAntelacion(String(p.antelacionDias))
        setAvisar(p.avisar)
      })
      .catch(() => vivo && setError('No se han podido leer los plazos'))
    return () => {
      vivo = false
    }
  }, [clienteId])

  const medido = useMemo(() => medirPlazos(remesas), [remesas])
  const soloTotal = guardado?.sinMigrar291 === true

  const dias = CLAVES_DE_ETAPA.map((k) => diasValidos(etapas[k]))
  const etapasBuenas: EtapasDePlazo | null = dias.every((d) => d !== null) ? { preparacion: dias[0] as number, transporte: dias[1] as number, recepcion: dias[2] as number, margen: dias[3] as number } : null
  const totalEtapas = etapasBuenas ? totalDeEtapas(etapasBuenas) : null
  const totalNumero = soloTotal ? diasValidos(total) : totalEtapas
  const totalBueno = totalNumero !== null && totalNumero >= 1 && totalNumero <= 365
  const antelacionBuena = diasValidos(antelacion)

  async function guardar() {
    if (!totalBueno || totalNumero === null || antelacionBuena === null) return
    setGuardando(true)
    try {
      const res = await fetch('/api/fba/alertas/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, ...(soloTotal ? { plazoDias: totalNumero } : { etapas: etapasBuenas }), antelacionDias: antelacionBuena, avisar }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se han podido guardar los plazos')
        return
      }
      toast.success(`Plazo de ${clienteNombre}: ${totalNumero} días`)
      onGuardado()
      onCerrar()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialogo
      titulo={`Plazos de ${clienteNombre}`}
      entradilla="Cuánto tarda desde que le avisamos hasta que su mercancía está a la venta en Amazon. De la suma dependen los avisos de «reponer ya» y «reponer pronto»."
      onCerrar={onCerrar}
      ancho="max-w-[640px]"
      pie={
        <>
          <button type="button" onClick={onCerrar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!guardado || !totalBueno || antelacionBuena === null || guardando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Guardar plazos
          </button>
        </>
      }
    >
      {error && (
        <div className="flex items-start gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] text-[var(--ls-t1)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.rojo}` }} role="alert">
          <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
          {error}
        </div>
      )}
      {!guardado && !error && (
        <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--ls-t3)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Leyendo…
        </div>
      )}

      {guardado && (
        <div className="space-y-4">
          {!guardado.configurado && (
            <p className="rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[7px] text-[12px] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
              Este cliente no tiene los plazos puestos: las alertas usan 45 días de partida. Ajusta las etapas a cómo trabaja de verdad.
            </p>
          )}
          {soloTotal && (
            <p className="rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[7px] text-[12px] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
              Falta lanzar la migración 291 en Supabase para guardar el plazo por etapas. Mientras, solo se puede poner el total.
            </p>
          )}

          {soloTotal ? (
            <div>
              <label className={CAMPO.etiqueta} htmlFor="pz-total">
                Plazo total (días)
              </label>
              <input id="pz-total" type="number" min={1} max={365} value={total} onChange={(e) => setTotal(e.target.value)} className={cx(CAMPO.input, CAMPO.numero, '!w-[96px]')} />
            </div>
          ) : (
            <div className="space-y-3">
              {CLAVES_DE_ETAPA.map((k) => (
                <div key={k} className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <label className="text-[12.5px] font-medium text-[var(--ls-t1)]" htmlFor={`pz-${k}`}>
                      {TEXTO[k].titulo}
                    </label>
                    <p className="text-[11.5px] leading-[1.45] text-[var(--ls-t4)]">{TEXTO[k].ayuda}</p>
                    {k === 'preparacion' && medido.preparacion && (
                      <Pista texto={`Sus últimos ${medido.preparacion.envios} envíos: ${medido.preparacion.dias} d de media desde que se aprobó la propuesta hasta que salió.`} onUsar={() => setEtapas((e) => ({ ...e, preparacion: String(medido.preparacion?.dias ?? 0) }))} />
                    )}
                    {(k === 'transporte' || k === 'recepcion') && medido.envioALlegada && (
                      <Pista
                        texto={`Sus últimos ${medido.envioALlegada.envios} envíos: ${medido.envioALlegada.dias} d de media entre que salió y Amazon confirmó la llegada (transporte y recepción juntos).`}
                        textoBoton="Repartir"
                        onUsar={() => {
                          const t = Math.round(medido.envioALlegada!.dias * 0.65)
                          setEtapas((e) => ({ ...e, transporte: String(t), recepcion: String(Math.max(0, medido.envioALlegada!.dias - t)) }))
                        }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <input id={`pz-${k}`} type="number" min={0} max={365} value={etapas[k]} onChange={(e) => setEtapas((x) => ({ ...x, [k]: e.target.value }))} className={cx(CAMPO.input, CAMPO.numero, '!w-[72px]')} />
                    <span className="text-[11.5px] text-[var(--ls-t4)]">días</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[10px]">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-[var(--ls-acc)]" />
              <span className="text-[12.5px] text-[var(--ls-t2)]">Plazo total</span>
              <b className="text-[18px] font-semibold tabular-nums text-[var(--ls-t1)]">{totalBueno ? totalNumero : '—'}</b>
              <span className="text-[12px] text-[var(--ls-t4)]">días</span>
            </div>
            <p className="text-right text-[12px] text-[var(--ls-t3)]">{totalBueno && totalNumero !== null ? <>Si avisamos hoy, estaría a la venta el <b className="text-[var(--ls-t1)]">{fecha(diaALaVenta(hoy, totalNumero))}</b></> : 'Pon días en cada etapa (el total, de 1 a 365)'}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={CAMPO.etiqueta} htmlFor="pz-antelacion">
                Aviso de «reponer pronto» con (días de antelación)
              </label>
              <input id="pz-antelacion" type="number" min={0} max={120} value={antelacion} onChange={(e) => setAntelacion(e.target.value)} className={cx(CAMPO.input, CAMPO.numero, '!w-[88px]')} />
              <p className={CAMPO.nota}>Con cuántos días por encima del plazo se avisa de que hay que reponer pronto.</p>
            </div>
            <label className="flex items-start gap-2 self-end text-[12.5px] text-[var(--ls-t2)]">
              <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} className="mt-[3px]" />
              <span>
                Avisar en la campana
                <span className="block text-[11.5px] text-[var(--ls-t4)]">Si no, las alertas se calculan y se ven pero no suenan.</span>
              </span>
            </label>
          </div>
          <p className="text-[11.5px] text-[var(--ls-t4)]">Una referencia que tarda distinto (la que viene por avión, la que se fabrica en otro sitio) tiene su propio plazo en Alertas → Plazos de reposición.</p>
        </div>
      )}
    </Dialogo>
  )
}

function Pista({ texto, onUsar, textoBoton = 'Usar' }: { texto: string; onUsar: () => void; textoBoton?: string }) {
  return (
    <p className="mt-[3px] text-[11.5px] leading-[1.45] text-[var(--ls-t3)]">
      {texto}{' '}
      <button type="button" onClick={onUsar} className="font-medium text-[var(--ls-acc)] underline">
        {textoBoton}
      </button>
    </p>
  )
}
