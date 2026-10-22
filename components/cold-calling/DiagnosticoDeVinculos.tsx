'use client'

import { AlertTriangle, CheckCircle2, Copy, Link2, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AVISO, BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { Diagnostico } from '@/lib/cold-calling/vinculos'
import { telefonoLegible } from '@/lib/rendimiento/telefonos'

/**
 * LA COMPROBACIÓN DE TELÉFONOS: ¿SE ENLAZAN LAS LLAMADAS DE RINKEL CON SU LEAD?
 *
 * Una llamada se enlaza con un lead cuando el número de Rinkel y el teléfono del lead dan la misma clave, escrito como se
 * haya escrito (con espacios, con +34, con puntos…). Un lead cuyo teléfono no se reconoce NO recibe nunca una llamada y no
 * da ningún error: esta pantalla enseña cuántos hay así y con qué teléfono, para corregirlos.
 *
 * Solo la ve quien supervisa al equipo comercial. «Enlazar ahora» lo puede pulsar solo un administrador.
 */

interface Respuesta {
  diagnostico: Diagnostico
  migracion237: boolean
}

interface Repaso {
  enlazadas: number
  contadas: number
  historicas: number
  faltaMigracion: boolean
}

const numero = (n: number) => n.toLocaleString('es-ES')
const porcentaje = (p: number) => `${(p * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`

function Cifra({ valor, rotulo, aviso = false, children }: { valor: number; rotulo: string; aviso?: boolean; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2">
      <p className={`text-[15px] font-semibold tabular-nums ${aviso && valor > 0 ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t1)]'}`}>{numero(valor)}</p>
      <p className="text-[11px] leading-snug text-[var(--ls-t4)]">{rotulo}</p>
      {children}
    </div>
  )
}

export function DiagnosticoDeVinculos({ abierto, onCerrar, esAdmin }: { abierto: boolean; onCerrar: () => void; esAdmin: boolean }) {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repasando, setRepasando] = useState(false)
  const [repaso, setRepaso] = useState<Repaso | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch('/api/cold-calling/vinculos', { cache: 'no-store' })
      const cuerpo = (await r.json().catch(() => null)) as (Respuesta & { error?: string }) | null
      if (!r.ok || !cuerpo?.diagnostico) setError(cuerpo?.error ?? 'No se ha podido hacer la comprobación.')
      else setDatos({ diagnostico: cuerpo.diagnostico, migracion237: cuerpo.migracion237 })
    } catch {
      setError('No se ha podido conectar. Vuelve a probar.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (abierto) {
      setRepaso(null)
      void cargar()
    }
  }, [abierto, cargar])

  async function enlazarAhora() {
    setRepasando(true)
    setError(null)
    try {
      const r = await fetch('/api/cold-calling/vinculos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'repasar' }) })
      const cuerpo = (await r.json().catch(() => null)) as (Respuesta & { resultado?: Repaso; error?: string }) | null
      if (!r.ok || !cuerpo?.diagnostico) setError(cuerpo?.error ?? 'No se ha podido enlazar.')
      else {
        setDatos({ diagnostico: cuerpo.diagnostico, migracion237: cuerpo.migracion237 })
        setRepaso(cuerpo.resultado ?? null)
      }
    } catch {
      setError('No se ha podido conectar. Vuelve a probar.')
    } finally {
      setRepasando(false)
    }
  }

  const d = datos?.diagnostico
  const pendientes = d?.llamadas.pendientesDeEnlazar ?? 0

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[88vh] max-w-2xl gap-3 overflow-y-auto rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 text-[var(--ls-t2)] sm:rounded-[10px]">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.012em] text-[var(--ls-t1)]">
            <Link2 className="h-4 w-4 text-[var(--ls-acc)]" aria-hidden /> Llamadas y teléfonos de los leads
          </DialogTitle>
          <DialogDescription className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
            Una llamada de Rinkel se apunta sola en el lead cuando su número y el teléfono del lead son el mismo, tecleado como se haya tecleado. Aquí se ve cuánto se está
            cumpliendo y qué teléfonos no se reconocen.
          </DialogDescription>
        </DialogHeader>

        {cargando && !d && (
          <p className="flex items-center gap-2 py-6 text-[12.5px] text-[var(--ls-t3)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Leyendo todas las llamadas y todos los leads…
          </p>
        )}

        {error && (
          <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }} role="alert">
            <AlertTriangle className={`${AVISO.icono} text-[var(--ls-e-ambar)]`} aria-hidden />
            <p>{error}</p>
          </div>
        )}

        {datos && !datos.migracion237 && (
          <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
            <AlertTriangle className={`${AVISO.icono} text-[var(--ls-e-ambar)]`} aria-hidden />
            <p>
              <span className={AVISO.fuerte}>Falta lanzar la migración 237.</span> Las llamadas se enlazan con su lead, pero todavía no suman el intento, no ponen el último contacto ni pasan «Sin
              contactar» a «No contesta».
            </p>
          </div>
        )}

        {d && (
          <>
            <section aria-labelledby="dv-llamadas" className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 id="dv-llamadas" className="text-[13px] font-semibold text-[var(--ls-t1)]">
                  Llamadas salientes
                </h3>
                <span className="text-[11.5px] tabular-nums text-[var(--ls-t3)]">
                  {numero(d.llamadas.salientesEnlazadas)} de {numero(d.llamadas.salientesConNumero)} enlazadas · <strong className="text-[var(--ls-t1)]">{porcentaje(d.llamadas.proporcionEnlazadas)}</strong>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ls-sup3)]" role="img" aria-label={`${porcentaje(d.llamadas.proporcionEnlazadas)} de las llamadas salientes están enlazadas`}>
                <div className="h-full rounded-full bg-[var(--ls-e-verde)] transition-[width] duration-700" style={{ width: `${Math.round(d.llamadas.proporcionEnlazadas * 100)}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Cifra valor={d.llamadas.salientesEnlazadas} rotulo="enlazadas con su lead" />
                <Cifra valor={pendientes} rotulo="se pueden enlazar ahora" aviso />
                <Cifra valor={d.llamadas.aLeadDeOtro} rotulo="a un lead de otro comercial" />
                <Cifra valor={d.llamadas.sinLead} rotulo="a números que no están en Cold Calling" />
              </div>
              <p className="text-[11px] leading-[1.5] text-[var(--ls-t4)]">
                {numero(d.llamadas.total)} llamadas en total ({numero(d.llamadas.salientes)} salientes) · {numero(d.llamadas.sinNumero)} con el número oculto, que no se pueden enlazar.
              </p>

              {esAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={enlazarAhora} disabled={repasando || !datos.migracion237 || cargando} className={`${BOTON.base} ${BOTON.alto} ${pendientes > 0 ? BOTON.primario : BOTON.secundario}`}>
                    {repasando ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Link2 className="h-3 w-3" aria-hidden />}
                    Enlazar ahora las que se puedan
                  </button>
                  {repaso && !repaso.faltaMigracion && (
                    <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t2)]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden />
                      {repaso.enlazadas === 0
                        ? 'No había nada más que enlazar.'
                        : `${numero(repaso.enlazadas)} enlazadas: ${numero(repaso.contadas)} recientes, contadas en su lead, y ${numero(repaso.historicas)} antiguas, solo enlazadas.`}
                    </span>
                  )}
                  {!datos.migracion237 && <span className="text-[11px] text-[var(--ls-t4)]">Primero hay que lanzar la migración 237.</span>}
                </div>
              )}
            </section>

            <section aria-labelledby="dv-leads" className="space-y-2">
              <h3 id="dv-leads" className="text-[13px] font-semibold text-[var(--ls-t1)]">
                Teléfonos de los leads
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Cifra valor={d.leads.total} rotulo="leads en total" />
                <Cifra valor={d.leads.conTelefono} rotulo="con un teléfono escrito" />
                <Cifra valor={d.leads.reconocidos} rotulo="con un teléfono reconocido" />
                <Cifra valor={d.leads.sinReconocer} rotulo="con teléfono que NO se reconoce" aviso />
              </div>

              {d.leads.sinReconocer === 0 ? (
                <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t2)]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden /> Todos los teléfonos escritos se reconocen: a todos los leads les pueden llegar llamadas.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">
                      A estos leads <strong className="text-[var(--ls-t1)]">no les llegará ninguna llamada</strong> mientras su teléfono se quede así (se enseñan los primeros {d.sinReconocer.length}).
                    </p>
                    <button
                      type="button"
                      className={`${BOTON.base} ${BOTON.secundario} shrink-0`}
                      onClick={() => {
                        void navigator.clipboard.writeText(d.sinReconocer.map((x) => `${x.nombre}\t${x.telefono}`).join('\n'))
                        toast.success('Lista copiada')
                      }}
                    >
                      <Copy className="h-3 w-3" aria-hidden /> Copiar
                    </button>
                  </div>
                  <ul className="max-h-40 divide-y divide-[var(--ls-linea)] overflow-y-auto rounded-[6px] border border-[var(--ls-linea)]">
                    {d.sinReconocer.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 px-2.5 py-1 text-[12px]">
                        <span className="min-w-0 truncate text-[var(--ls-t1)]">{x.nombre}</span>
                        <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-e-ambar)]">{x.telefono}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {d.leads.compartidos > 0 && (
                <div className="space-y-1">
                  <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">
                    <strong className="text-[var(--ls-t1)]">{numero(d.leads.compartidos)}</strong> {d.leads.compartidos === 1 ? 'teléfono lo comparten' : 'teléfonos los comparten'} varios leads de la misma persona. La llamada
                    se apunta en uno solo (el que sigue abierto y se tocó más recientemente).
                  </p>
                  <ul className="max-h-28 divide-y divide-[var(--ls-linea)] overflow-y-auto rounded-[6px] border border-[var(--ls-linea)]">
                    {d.compartidos.map((c) => (
                      <li key={c.telefono} className="flex items-center justify-between gap-3 px-2.5 py-1 text-[12px]">
                        <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t2)]">{telefonoLegible(c.telefono.replace(/\s/g, ''))}</span>
                        <span className="min-w-0 truncate text-[var(--ls-t3)]">{c.leads.join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {d.numerosSinLead.length > 0 && (
              <section aria-labelledby="dv-numeros" className="space-y-1.5">
                <h3 id="dv-numeros" className="text-[13px] font-semibold text-[var(--ls-t1)]">
                  Números a los que más se ha llamado sin estar en Cold Calling
                </h3>
                <ul className="divide-y divide-[var(--ls-linea)] rounded-[6px] border border-[var(--ls-linea)]">
                  {d.numerosSinLead.map((x) => (
                    <li key={x.numero} className="flex items-center justify-between gap-3 px-2.5 py-1 text-[12px]">
                      <span className="font-mono text-[11.5px] text-[var(--ls-t1)]">{telefonoLegible(x.numero)}</span>
                      <span className="text-[var(--ls-t3)]">
                        {x.llamadas} {x.llamadas === 1 ? 'llamada' : 'llamadas'} · {x.comercial}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex justify-end">
              <button type="button" onClick={() => void cargar()} disabled={cargando} className={`${BOTON.base} ${BOTON.secundario}`}>
                <RefreshCw className={`h-3 w-3 ${cargando ? 'animate-spin' : ''}`} aria-hidden /> Volver a comprobar
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
