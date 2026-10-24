'use client'

import { FlaskConical, Gauge, Loader2, Plus, Power, Rocket, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Avatar, CabeceraDePanel, PANEL, Revelar } from '@/components/rendimiento/ui'
import { diaCorto, horaDeMinutos } from '@/lib/correo/secuencias/fechas'
import type { AjustesDelMotor } from '@/lib/correo/secuencias/reglas'
import { enviarJson, pedir } from '../api'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from '../ui'
import { cuando, type Tablero } from './datos'

/**
 * LOS AJUSTES DEL MOTOR — SOLO UN ADMINISTRADOR LOS CAMBIA.
 *
 * El interruptor de tres posiciones (apagado · ensayo · envío real), el horario, los huecos entre envíos, la rampa de volumen, el freno por rebotes, los festivos,
 * qué hace la IA con las respuestas de los leads, cada buzón y las direcciones que han rebotado. Cualquiera que pueda ver Secuencias ve esto (para saber cómo funciona), pero los controles solo se activan para
 * un administrador, y el servidor lo vuelve a comprobar. Pasar a «envío real» pide confirmación expresa.
 */

type Modo = 'apagado' | 'ensayo' | 'real'
const modoDe = (a: Pick<AjustesDelMotor, 'activa' | 'modoEnsayo'>): Modo => (!a.activa ? 'apagado' : a.modoEnsayo ? 'ensayo' : 'real')

const aHora = (min: number): string => horaDeMinutos(min).padStart(5, '0')
const aMinutos = (hora: string): number => {
  const [h, m] = hora.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0
}

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11.5px] font-medium text-[var(--ls-t2)]">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-[10.5px] leading-snug text-[var(--ls-t4)]">{ayuda}</span>}
    </label>
  )
}

function Interruptor({ titulo, texto, activo, desactivado, onCambio }: { titulo: string; texto: string; activo: boolean; desactivado: boolean; onCambio: (v: boolean) => void }) {
  return (
    <div className={`flex items-start gap-3 ${desactivado ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-[var(--ls-t1)]">{titulo}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ls-t3)]">{texto}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={titulo}
        disabled={desactivado}
        onClick={() => onCambio(!activo)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-default ${activo ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-relleno)]' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup3)]'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${activo ? 'translate-x-4' : ''}`} aria-hidden />
      </button>
    </div>
  )
}

const OPCIONES: Array<{ modo: Modo; titulo: string; texto: string; Icono: typeof Power }> = [
  { modo: 'apagado', titulo: 'Apagado', texto: 'No hace nada. El equipo ni ve la función en el cuadro de Correo.', Icono: Power },
  { modo: 'ensayo', titulo: 'Ensayo', texto: 'Vigila, reparte horas y decide, pero NO envía nada. Apunta lo que habría hecho.', Icono: FlaskConical },
  { modo: 'real', titulo: 'Envío real', texto: 'Los seguimientos salen de verdad a su hora, desde el buzón de cada comercial.', Icono: Rocket },
]

interface Props {
  tablero: Tablero
  esAdmin: boolean
  /** Hay cambios guardados: que la pantalla refresque el tablero */
  alGuardar: () => void
}

export function AjustesDeSecuencias({ tablero, esAdmin, alGuardar }: Props) {
  const base = tablero.ajustes
  const [form, setForm] = useState<AjustesDelMotor>(base)
  const [guardando, setGuardando] = useState(false)
  const [confirmaReal, setConfirmaReal] = useState(false)
  const [festivo, setFestivo] = useState('')
  const [malas, setMalas] = useState<Array<{ direccion: string; estado: string; motivo: string | null; origen: string; veces: number; ultimaVez: number }> | null>(null)

  // Si los ajustes cambian por fuera (otra persona, o este mismo guardado), el formulario se pone al día
  const firmaBase = JSON.stringify(base)
  useEffect(() => setForm(base), [firmaBase]) // eslint-disable-line react-hooks/exhaustive-deps

  const modoActual = modoDe(base)
  const modoForm = modoDe(form)
  const sucio = useMemo(() => JSON.stringify(form) !== firmaBase, [form, firmaBase])
  const set = <K extends keyof AjustesDelMotor>(k: K, v: AjustesDelMotor[K]) => setForm((f) => ({ ...f, [k]: v }))

  const cargarMalas = useCallback(async () => {
    if (!esAdmin) return
    const r = await pedir<{ direcciones: NonNullable<typeof malas> }>('/api/correo/secuencias/direcciones')
    if (r.ok) setMalas(r.datos.direcciones)
  }, [esAdmin])
  useEffect(() => {
    void cargarMalas()
  }, [cargarMalas])

  async function guardar(extra: Record<string, unknown> = {}) {
    setGuardando(true)
    const cambios: Record<string, unknown> = { ...extra }
    for (const k of Object.keys(form) as Array<keyof AjustesDelMotor>) if (JSON.stringify(form[k]) !== JSON.stringify(base[k])) cambios[k] = form[k]
    const r = await enviarJson<{ avisos?: string[] }>('/api/correo/secuencias/ajustes', 'POST', { motor: cambios })
    setGuardando(false)
    if (!r.ok) return toast.error(r.mensaje)
    toast.success('Ajustes guardados.')
    for (const a of r.datos.avisos ?? []) toast.warning(a, { duration: 9000 })
    setConfirmaReal(false)
    alGuardar()
  }

  async function elegirModo(m: Modo) {
    if (!esAdmin || m === modoForm) return
    if (m === 'real') return setConfirmaReal(true)
    setForm((f) => ({ ...f, activa: m !== 'apagado', modoEnsayo: m === 'ensayo' ? true : f.modoEnsayo }))
  }

  async function cambiarBuzon(id: string, cambios: Record<string, unknown>, mensaje: string) {
    const r = await enviarJson('/api/correo/secuencias/ajustes', 'POST', { buzon: { id, ...cambios } })
    if (!r.ok) return toast.error(r.mensaje)
    toast.success(mensaje)
    alGuardar()
  }

  async function liberar(direccion: string) {
    const r = await enviarJson('/api/correo/secuencias/direcciones', 'POST', { direccion, accion: 'liberar' })
    if (!r.ok) return toast.error(r.mensaje)
    toast.success('Dirección liberada.')
    void cargarMalas()
  }

  const solo = !esAdmin
  const sinGuardar = sucio && esAdmin

  return (
    <div className="space-y-3 pb-16">
      {solo && <p className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] text-[var(--ls-t3)]">Estás viendo cómo está configurado el motor. Solo un administrador puede cambiarlo.</p>}

      <section className={PANEL} aria-label="Estado del motor">
        <CabeceraDePanel icono={<Power className="h-3.5 w-3.5" aria-hidden />} titulo="Estado del motor" contexto={`· ahora: ${OPCIONES.find((o) => o.modo === modoActual)?.titulo.toLowerCase()}`} />
        <div className="grid gap-2.5 p-3 md:grid-cols-3" role="radiogroup" aria-label="Modo del motor">
          {OPCIONES.map((o, i) => {
            const activo = modoForm === o.modo
            return (
              <Revelar key={o.modo} i={i}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  disabled={solo}
                  onClick={() => void elegirModo(o.modo)}
                  className={`h-full w-full rounded-[10px] border p-3 text-left transition-colors disabled:cursor-default ${
                    activo
                      ? o.modo === 'real'
                        ? 'border-[var(--ls-e-verde)] bg-[color-mix(in_srgb,var(--ls-e-verde)_10%,transparent)]'
                        : 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)]'
                      : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)]'
                  }`}
                >
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ls-t1)]">
                    <o.Icono className={`h-4 w-4 ${activo ? (o.modo === 'real' ? 'text-[var(--ls-e-verde)]' : 'text-[var(--ls-acc)]') : 'text-[var(--ls-t4)]'}`} aria-hidden /> {o.titulo}
                    {modoActual === o.modo && <span className="ml-auto rounded-[4px] bg-[var(--ls-sup3)] px-1.5 text-[10px] font-medium text-[var(--ls-t3)]">ahora</span>}
                  </span>
                  <span className="mt-1 block text-[11.5px] leading-snug text-[var(--ls-t3)]">{o.texto}</span>
                </button>
              </Revelar>
            )
          })}
        </div>
        {confirmaReal && (
          <div className="mx-3 mb-3 rounded-[10px] border border-[var(--ls-e-ambar)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] p-3" role="alertdialog" aria-label="Confirmar el envío real">
            <p className="flex items-start gap-2 text-[12.5px] leading-snug text-[var(--ls-t1)]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
              <span>
                <strong>Vas a pasar a envío real.</strong> Desde ese momento los seguimientos programados salen de verdad, a su hora, desde los buzones de los comerciales y a nombre de ellos. Lo que ya estaba programado y su hora se pasó mientras estaba apagado se vuelve a repartir (no sale de golpe). Puedes volver a ensayo o apagarlo cuando quieras.
              </span>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" disabled={guardando} onClick={() => void guardar({ activa: true, modoEnsayo: false, confirmarEnvioReal: true })} className={`${BOTON_PRIMARIO} !h-8 !px-3 !text-[12.5px]`}>
                {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Sí, enviar de verdad
              </button>
              <button type="button" onClick={() => setConfirmaReal(false)} className={BOTON_SECUNDARIO}>
                No, todavía no
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={PANEL} aria-label="Horario y reparto">
        <CabeceraDePanel icono={<Gauge className="h-3.5 w-3.5" aria-hidden />} titulo="Horario y reparto" contexto="· hora de Madrid, de lunes a viernes" />
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo etiqueta="Empieza a enviar a las">
            <input type="time" disabled={solo} value={aHora(form.ventanaDesdeMin)} onChange={(e) => set('ventanaDesdeMin', aMinutos(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Deja de enviar a las" ayuda="Los últimos 4 minutos se dejan libres a propósito.">
            <input type="time" disabled={solo} value={aHora(form.ventanaHastaMin === 1440 ? 1439 : form.ventanaHastaMin)} onChange={(e) => set('ventanaHastaMin', aMinutos(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Parte de la mañana (antes de las 14:00)" ayuda="Qué porcentaje de los envíos cae por la mañana; el resto, por la tarde.">
            <input type="number" min={0} max={100} disabled={solo} value={form.pesoMananaPct} onChange={(e) => set('pesoMananaPct', Number(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Entre dos envíos cualesquiera (segundos)" ayuda="Como mínimo: nunca salen dos a la vez.">
            <input type="number" min={5} max={3600} disabled={solo} value={form.huecoGlobalS} onChange={(e) => set('huecoGlobalS', Number(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Entre dos del mismo buzón (segundos)">
            <input type="number" min={10} max={7200} disabled={solo} value={form.huecoBuzonS} onChange={(e) => set('huecoBuzonS', Number(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Máximo por hora y buzón" ayuda="Cuenta también lo que la persona manda a mano.">
            <input type="number" min={1} max={500} disabled={solo} value={form.topeHora} onChange={(e) => set('topeHora', Number(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Días hábiles hasta «No interesa»" ayuda="Si nadie contesta al último correo, el lead pasa solo a «No interesa» pasados estos días.">
            <input type="number" min={1} max={60} disabled={solo} value={form.diasHastaNoInteresa} onChange={(e) => set('diasHastaNoInteresa', Number(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Freno: % de rebotes" ayuda="Si un buzón rebota más de esto en 24 h, se pausa hasta el siguiente día hábil.">
            <input type="number" min={1} max={100} disabled={solo} value={form.frenoRebotesPct} onChange={(e) => set('frenoRebotesPct', Number(e.target.value))} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Freno: mínimo de envíos" ayuda="Con menos envíos que estos no se mide (un rebote suelto no es una tasa).">
            <input type="number" min={5} max={1000} disabled={solo} value={form.frenoMinimoEnvios} onChange={(e) => set('frenoMinimoEnvios', Number(e.target.value))} className={CAMPO} />
          </Campo>
        </div>
      </section>

      <section className={PANEL} aria-label="Rampa de volumen">
        <CabeceraDePanel titulo="Rampa de volumen" contexto="· correos al día por buzón, a mano y automáticos juntos" />
        <div className="space-y-2 p-3">
          <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">Un buzón empieza con poco y sube con los días hábiles que lleva funcionando: así su reputación crece despacio. Los que la persona escribe a mano siempre tienen prioridad; los seguimientos ocupan el hueco que queda.</p>
          <ul className="space-y-1.5">
            {form.rampa.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
                <span className="shrink-0 whitespace-nowrap">Desde el día hábil</span>
                <input type="number" min={1} disabled={solo || i === 0} value={t.desde} onChange={(e) => set('rampa', form.rampa.map((x, j) => (j === i ? { ...x, desde: Number(e.target.value) } : x)))} className={`${CAMPO} !w-20`} aria-label={`Día en que empieza el tramo ${i + 1}`} />
                <span>hasta</span>
                <input type="number" min={1} max={1000} disabled={solo} value={t.tope} onChange={(e) => set('rampa', form.rampa.map((x, j) => (j === i ? { ...x, tope: Number(e.target.value) } : x)))} className={`${CAMPO} !w-24`} aria-label={`Tope diario del tramo ${i + 1}`} />
                <span>al día</span>
                {!solo && i > 0 && (
                  <button type="button" onClick={() => set('rampa', form.rampa.filter((_, j) => j !== i))} className="ml-auto text-[var(--ls-t4)] hover:text-[var(--ls-e-rojo)]" aria-label="Quitar el tramo">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!solo && form.rampa.length < 12 && (
            <button type="button" onClick={() => set('rampa', [...form.rampa, { desde: (form.rampa[form.rampa.length - 1]?.desde ?? 1) + 5, tope: (form.rampa[form.rampa.length - 1]?.tope ?? 40) + 30 }])} className={BOTON_SECUNDARIO}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Añadir un tramo
            </button>
          )}
        </div>
      </section>

      <section className={PANEL} aria-label="Festivos">
        <CabeceraDePanel titulo="Festivos" contexto="· días en los que no se envía además de sábados y domingos" />
        <div className="space-y-2 p-3">
          <ul className="flex flex-wrap gap-1.5">
            {form.festivos.length === 0 && <li className="text-[12px] text-[var(--ls-t4)]">Ninguno.</li>}
            {form.festivos.map((d) => (
              <li key={d} className="inline-flex h-6 items-center gap-1.5 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-2 pr-1 text-[11.5px] tabular-nums text-[var(--ls-t2)]">
                {diaCorto(d)} {d.slice(0, 4)}
                {!solo && (
                  <button type="button" onClick={() => set('festivos', form.festivos.filter((x) => x !== d))} className="flex h-4 w-4 items-center justify-center rounded text-[var(--ls-t4)] hover:text-[var(--ls-e-rojo)]" aria-label={`Quitar el festivo ${d}`}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!solo && (
            <div className="flex items-center gap-2">
              <input type="date" value={festivo} onChange={(e) => setFestivo(e.target.value)} className={`${CAMPO} !w-44`} aria-label="Nuevo festivo" />
              <button type="button" disabled={!festivo || form.festivos.includes(festivo)} onClick={() => { set('festivos', [...form.festivos, festivo].sort()); setFestivo('') }} className={BOTON_SECUNDARIO}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Añadir
              </button>
            </div>
          )}
        </div>
      </section>

      <section className={PANEL} aria-label="Respuestas de los leads">
        <CabeceraDePanel icono={<Sparkles className="h-3.5 w-3.5" aria-hidden />} titulo="Respuestas de los leads" contexto="· lo que hace la IA cuando alguien contesta" />
        <div className="space-y-3.5 p-3">
          <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">
            Cuando un lead contesta a un correo, la IA lee su respuesta y deja en su historial qué ha dicho. Con el motor en <strong className="font-semibold text-[var(--ls-t2)]">ensayo</strong> solo lo apunta en Secuencias → Flujo; con{' '}
            <strong className="font-semibold text-[var(--ls-t2)]">envío real</strong> además mueve la ficha. Solo actúa si está segura, y no toca los leads que ya están en seguimiento o con cita, ni los de otro comercial: a esos les deja una nota para que los mire una persona.
          </p>
          {!base.respuestasDisponible && (
            <p className="flex items-start gap-2 rounded-[8px] border border-[var(--ls-e-ambar)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-2 text-[11.5px] leading-snug text-[var(--ls-t1)]">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
              <span>Falta lanzar la migración 246_correo_respuestas_ia.sql en el editor SQL de Supabase. Hasta entonces estos interruptores no se pueden cambiar y la IA no lee nada.</span>
            </p>
          )}
          <Interruptor titulo="Leer las respuestas con la IA" texto="Apaga todo lo de abajo de golpe. Cada lectura cuesta una fracción de céntimo." activo={form.respuestasIa} desactivado={solo || !base.respuestasDisponible} onCambio={(v) => set('respuestasIa', v)} />
          <Interruptor
            titulo="Pasar a «No le interesa» a quien dice que no"
            texto="Solo cuando lo dice con claridad («no, gracias», «no nos interesa») o pide que no se le escriba más. Si la IA duda, deja una nota."
            activo={form.respuestasCerrarNo}
            desactivado={solo || !base.respuestasDisponible || !form.respuestasIa}
            onCambio={(v) => set('respuestasCerrarNo', v)}
          />
          <Interruptor
            titulo="Poner la rellamada a quien pide que le escribas más adelante"
            texto="«Escríbeme en enero» deja la fecha en «Rellamar el» de Cold Calling y el lead en «Programado». Si no da fecha, se pone a 30 días."
            activo={form.respuestasRellamada}
            desactivado={solo || !base.respuestasDisponible || !form.respuestasIa}
            onCambio={(v) => set('respuestasRellamada', v)}
          />
        </div>
      </section>

      <section className={PANEL} aria-label="Buzones">
        <CabeceraDePanel titulo="Buzones" contexto="· cada uno con su propio ritmo" />
        <ul>
          {tablero.buzones.map((b) => {
            const enPausa = b.pausadoHasta !== null && b.pausadoHasta > tablero.ahora
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--ls-linea)] px-3 py-2.5 last:border-b-0">
                <div className="flex min-w-[190px] flex-1 items-center gap-2">
                  <Avatar id={b.id} nombre={b.propietario.nombre} tamano={26} />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{b.propietario.nombre}</p>
                    <p className="truncate text-[11px] text-[var(--ls-t4)]">{b.direccion}</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
                  <input type="checkbox" disabled={solo} checked={b.participa} onChange={(e) => void cambiarBuzon(b.id, { participa: e.target.checked }, e.target.checked ? 'El buzón vuelve a participar.' : 'El buzón ya no participa.')} className="h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" /> Participa
                </label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
                  Tope fijo
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    disabled={solo}
                    defaultValue={b.topeDiario ?? ''}
                    placeholder="rampa"
                    onBlur={(e) => {
                      const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                      if (v !== b.topeDiario) void cambiarBuzon(b.id, { topeDiario: v }, v === null ? 'El buzón vuelve a seguir la rampa.' : `Tope fijo de ${v} al día.`)
                    }}
                    className={`${CAMPO} !h-7 !w-20 !text-[12px]`}
                    aria-label={`Tope fijo de ${b.propietario.nombre}`}
                  />
                </label>
                <span className="text-[11.5px] text-[var(--ls-t4)]" title="Las horas en las que llama (y manda a mano): el reparto de los automáticos se aparta de ellas">
                  Llama de {aHora(b.llamadasDesdeMin)} a {aHora(b.llamadasHastaMin)}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {enPausa ? (
                    <>
                      <span className="text-[11.5px] text-[var(--ls-e-ambar)]" title={b.motivoPausa ?? undefined}>
                        En pausa hasta {cuando(b.pausadoHasta as number, tablero.ahora)}
                      </span>
                      {!solo && (
                        <button type="button" onClick={() => void cambiarBuzon(b.id, { quitarPausa: true }, 'Pausa quitada.')} className={BOTON_SECUNDARIO}>
                          Quitar la pausa
                        </button>
                      )}
                    </>
                  ) : (
                    !solo && (
                      <button type="button" onClick={() => void cambiarBuzon(b.id, { pausarHastaMañana: true }, 'Buzón en pausa hasta el siguiente día hábil.')} className={BOTON_SECUNDARIO}>
                        Pausar hasta mañana
                      </button>
                    )
                  )}
                </div>
                {enPausa && b.motivoPausa && <p className="w-full text-[11px] leading-snug text-[var(--ls-t4)]">{b.motivoPausa}</p>}
              </li>
            )
          })}
        </ul>
      </section>

      {esAdmin && (
        <section className={PANEL} aria-label="Direcciones que han rebotado">
          <CabeceraDePanel titulo="Direcciones que han rebotado" contexto="· el ERP no vuelve a escribirles" />
          {malas === null ? (
            <p className="px-3 py-4 text-[12px] text-[var(--ls-t4)]">Cargando…</p>
          ) : malas.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-[var(--ls-t4)]">Ninguna todavía.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {malas.map((m) => (
                <li key={m.direccion} className="flex items-center gap-3 border-b border-[var(--ls-linea)] px-3 py-1.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[12.5px] ${m.estado === 'mala' ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)] line-through'}`}>{m.direccion}</span>
                    <span className="block truncate text-[10.5px] text-[var(--ls-t4)]">
                      {m.motivo ?? m.origen} · {m.veces} {m.veces === 1 ? 'vez' : 'veces'}
                    </span>
                  </span>
                  {m.estado === 'mala' && (
                    <button type="button" onClick={() => void liberar(m.direccion)} className={BOTON_SECUNDARIO} title="Si en realidad funciona (se arregló), se vuelve a poder escribirle">
                      Liberar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {sinGuardar && (
        <div className="sticky bottom-3 z-20 mx-auto flex w-fit items-center gap-3 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 py-2.5 shadow-2xl shadow-black/50 rend-aviso">
          <span className="text-[12.5px] text-[var(--ls-t2)]">Hay cambios sin guardar</span>
          <button type="button" disabled={guardando} onClick={() => void guardar()} className={`${BOTON_PRIMARIO} !h-8 !px-3 !text-[12.5px]`}>
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
          </button>
          <button type="button" onClick={() => setForm(base)} className="text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
            Descartar
          </button>
        </div>
      )}
    </div>
  )
}
