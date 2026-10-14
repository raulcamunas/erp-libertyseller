'use client'

import { useState } from 'react'
import { AlertTriangle, Check, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { BOTON, CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { cx } from '../comun/ui'

/**
 * MARCAR COMO ENVIADA: ENLAZAR LA PROPUESTA CON SU ENVÍO REAL.
 *
 * Es el momento en que una propuesta deja de serlo y pasa a «Envíos», que solo
 * enseña envíos que existen en Amazon. Por eso aquí se pide el número de envío
 * FBA —el que da Seller Central al crear el envío— y se hacen tres cosas en
 * orden, que se ven mientras pasan:
 *
 *   1. guardar el número en la remesa;
 *   2. comprobarlo contra Amazon: una errata se descubre ahora y no mañana;
 *   3. marcarla como enviada.
 *
 * Si Amazon no reconoce el número, NO se marca: se dice y se corrige. Si Amazon
 * no se puede consultar (el cliente no tiene la API conectada, o contesta mal) sí
 * se puede seguir, pero a propósito y sabiéndolo: la remesa quedará enlazada pero
 * su estado no se seguirá solo.
 */

const FBA = /^FBA[0-9A-Z]{6,20}$/

type Fase = 'quieta' | 'guardando' | 'comprobando' | 'marcando'

export function EnlazarEnvioDialog({ remesa, onCerrar, onHecho }: { remesa: RemesaDePanel; onCerrar: () => void; onHecho: () => void }) {
  const [numero, setNumero] = useState(remesa.referenciaEnvio ?? '')
  const [fase, setFase] = useState<Fase>('quieta')
  const [error, setError] = useState<string | null>(null)
  const [noSePudoComprobar, setNoSePudoComprobar] = useState<string | null>(null)

  const limpio = numero.trim().toUpperCase()
  const valido = FBA.test(limpio)
  const ocupado = fase !== 'quieta'

  async function ejecutar(omitirComprobacion: boolean) {
    setError(null)
    setNoSePudoComprobar(null)
    try {
      // 1. El número
      if (limpio !== (remesa.referenciaEnvio ?? '')) {
        setFase('guardando')
        const res = await fetch(`/api/fba/remesas/${remesa.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenciaEnvio: limpio }),
        })
        if (!res.ok) {
          const p = (await res.json().catch(() => null)) as { error?: string } | null
          setError(p?.error ?? 'No se ha podido guardar el número de envío')
          return
        }
      }

      // 2. Amazon
      if (!omitirComprobacion) {
        setFase('comprobando')
        const res = await fetch(`/api/fba/remesas/${remesa.id}/seguir`, { method: 'POST' })
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        if (res.status === 404) {
          setError(p?.error ?? 'Amazon no reconoce ese número de envío')
          return
        }
        if (!res.ok) {
          setNoSePudoComprobar(p?.error ?? 'No se ha podido consultar a Amazon')
          return
        }
      }

      // 3. El paso
      setFase('marcando')
      const res = await fetch(`/api/fba/remesas/${remesa.id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasta: 'enviada' }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; motivos?: string[] } | null
      if (!res.ok) {
        setError(p?.motivos?.join('\n') ?? p?.error ?? 'No se ha podido marcar como enviada')
        return
      }
      toast.success('Enviada y enlazada con Amazon: ya está en Envíos')
      onHecho()
    } finally {
      setFase('quieta')
    }
  }

  return (
    <Dialogo
      titulo="Marcar como enviada"
      entradilla="La propuesta deja de serlo y pasa a la pestaña Envíos, enlazada con su envío de Amazon."
      onCerrar={ocupado ? () => undefined : onCerrar}
      ancho="max-w-[480px]"
      pie={
        <>
          <button type="button" onClick={onCerrar} disabled={ocupado} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cancelar
          </button>
          {noSePudoComprobar ? (
            <button type="button" onClick={() => void ejecutar(true)} disabled={ocupado} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
              {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Marcar sin comprobar
            </button>
          ) : (
            <button type="button" onClick={() => void ejecutar(false)} disabled={!valido || ocupado} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
              {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Marcar como enviada
            </button>
          )}
        </>
      }
    >
      <div>
        <label className={CAMPO.etiqueta} htmlFor="numero-fba">
          Número de envío FBA <span className={CAMPO.obligatorio}>*</span>
        </label>
        <input
          id="numero-fba"
          value={numero}
          onChange={(e) => {
            setNumero(e.target.value)
            setError(null)
            setNoSePudoComprobar(null)
          }}
          placeholder="FBA15ABCDEF"
          spellCheck={false}
          autoFocus
          disabled={ocupado}
          className={cx(CAMPO.input, 'h-[30px] font-mono text-[13px]')}
        />
        <p className={CAMPO.nota}>
          Lo da Seller Central al crear el envío y empieza por <span className="font-mono">FBA</span>. No es el de la remesa ni el del transportista.
          {numero.trim() !== '' && !valido && <span className="ml-1" style={{ color: COLOR_ESTADO.ambar }}>Ese formato no es el de un envío de Amazon.</span>}
        </p>
      </div>

      <ol className="space-y-[6px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-[10px] py-[8px]">
        {(
          [
            ['guardando', 'Guardar el número en la remesa'],
            ['comprobando', 'Comprobar que Amazon lo reconoce'],
            ['marcando', 'Marcarla como enviada y pasarla a Envíos'],
          ] as Array<[Fase, string]>
        ).map(([f, texto], i) => {
          const orden: Fase[] = ['guardando', 'comprobando', 'marcando']
          const hecho = ocupado && orden.indexOf(fase) > i
          const activo = fase === f
          return (
            <li key={f} className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
              <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border border-[var(--ls-linea2)] text-[10px] text-[var(--ls-t4)]">
                {hecho ? <Check className="h-[10px] w-[10px]" style={{ color: COLOR_ESTADO.verde }} strokeWidth={3} /> : activo ? <Loader2 className="h-[10px] w-[10px] animate-spin" /> : i + 1}
              </span>
              {texto}
            </li>
          )
        })}
      </ol>

      {error && (
        <div
          className="flex items-start gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t1)]"
          style={{ borderLeft: `3px solid ${COLOR_ESTADO.rojo}` }}
          role="alert"
        >
          <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}
      {noSePudoComprobar && (
        <div
          className="flex items-start gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t1)]"
          style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}
          role="alert"
        >
          <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
          <span>
            {noSePudoComprobar} Puedes marcarla igualmente: quedará enlazada con el número, pero su estado en Amazon no se seguirá solo.
          </span>
        </div>
      )}
    </Dialogo>
  )
}
