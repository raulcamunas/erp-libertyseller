'use client'

import { Activity, CircleOff, FlaskConical, HeartPulse, MailCheck, OctagonAlert, Pause, Plug, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Avatar, CabeceraDePanel, PANEL, Revelar } from '@/components/rendimiento/ui'
import { duracionTexto, porcentajeTexto, type Alarma, type NivelDeSalud, type SaludDelBuzon } from '@/lib/correo/secuencias/salud'
import { hace } from '@/lib/correo/secuencias/vistas'
import type { Tablero } from './datos'
import { cuando } from './datos'

/**
 * LA SALUD DE LOS SEGUIMIENTOS Y DE LOS BUZONES.
 *
 * Arriba, un veredicto en una frase («Todo en orden» o lo que hay que mirar) y, si hay algo, la lista de ALARMAS con qué pasa y qué hacer. Debajo, el
 * motor (solo para quien administra: la última vez que se ejecutó, cuántas pasadas fallan, correos atrasados y envíos fallidos) y UNA TARJETA POR
 * BUZÓN: cómo va su conexión, lo que ha enviado hoy frente a su tope, en qué punto de la rampa está y cuánto rebota. Lo que merece un aviso llega
 * además a la campana de los administradores y, si es de un buzón, de su dueño (lib/correo/secuencias/alarmas.ts).
 */

const COLOR_DE_NIVEL: Record<NivelDeSalud, string> = { ok: 'var(--ls-e-verde)', atencion: 'var(--ls-e-ambar)', problema: 'var(--ls-e-rojo)' }
const COLOR_DE_GRAVEDAD: Record<Alarma['gravedad'], string> = { roja: 'var(--ls-e-rojo)', ambar: 'var(--ls-e-ambar)' }

function Dato({ titulo, children, tono }: { titulo: string; children: ReactNode; tono?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[var(--ls-t4)]">{titulo}</dt>
      <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-[var(--ls-t1)]" style={tono ? { color: tono } : undefined}>
        {children}
      </dd>
    </div>
  )
}

function Veredicto({ salud }: { salud: Tablero['salud'] }) {
  const color = COLOR_DE_NIVEL[salud.nivel]
  const Icono = salud.nivel === 'ok' ? ShieldCheck : salud.nivel === 'atencion' ? TriangleAlert : OctagonAlert
  return (
    <section className={`${PANEL} flex items-center gap-3 px-4 py-3`} aria-label="Resumen de la salud" style={{ borderColor: `color-mix(in srgb, ${color} 35%, var(--ls-linea))` }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        <Icono className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-[var(--ls-t1)]">{salud.resumen}</h2>
        <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">
          Se mira cada vez que se abre esta pantalla y, aparte, cada pocos minutos. Lo grave llega además a la campana de los administradores y, si es de un buzón, de su dueño.
        </p>
      </div>
    </section>
  )
}

function ListaDeAlarmas({ salud }: { salud: Tablero['salud'] }) {
  if (salud.alarmas.length === 0) return null
  const dueno = (a: Alarma) => (a.buzonId ? salud.buzones.find((b) => b.buzonId === a.buzonId) : undefined)
  return (
    <section className={PANEL} aria-label="Alarmas">
      <CabeceraDePanel icono={<TriangleAlert className="h-3.5 w-3.5" aria-hidden />} titulo="Lo que hay que mirar" contexto={`· ${salud.alarmas.length}`} />
      <ul>
        {salud.alarmas.map((a, i) => {
          const color = COLOR_DE_GRAVEDAD[a.gravedad]
          const b = dueno(a)
          const Icono = a.gravedad === 'roja' ? OctagonAlert : TriangleAlert
          return (
            <li key={a.clave} className="sec-sube flex items-start gap-3 border-b border-l-2 border-b-[var(--ls-linea)] px-3 py-2.5 last:border-b-0" style={{ borderLeftColor: color, '--d': Math.min(i, 10) } as CSSProperties}>
              <Icono className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{a.titulo}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-[var(--ls-t3)]">{a.detalle}</p>
              </div>
              {b && !b.esMio && (
                <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-[var(--ls-t4)] sm:flex">
                  <Avatar id={b.buzonId} nombre={b.propietario} tamano={16} /> {b.propietario}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PanelDelMotor({ salud, ahora }: { salud: Tablero['salud']; ahora: number }) {
  const m = salud.motor
  if (!m) return null
  const ModoIcono = m.modo === 'real' ? Activity : m.modo === 'ensayo' ? FlaskConical : CircleOff
  const modoTexto = m.modo === 'real' ? 'Envío real' : m.modo === 'ensayo' ? 'Ensayo (no envía)' : 'Apagado'
  const ultima = m.ultimaPasada
  const rojo = COLOR_DE_GRAVEDAD.roja
  const ambar = COLOR_DE_GRAVEDAD.ambar
  return (
    <section className={PANEL} aria-label="El motor">
      <CabeceraDePanel icono={<Activity className="h-3.5 w-3.5" aria-hidden />} titulo="El motor" contexto="· el proceso que reparte las horas y envía" />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-3 sm:grid-cols-3 lg:grid-cols-4">
        <Dato titulo="Modo">
          <span className="inline-flex items-center gap-1.5">
            <ModoIcono className="h-3.5 w-3.5 text-[var(--ls-t3)]" aria-hidden /> {modoTexto}
          </span>
        </Dato>
        <Dato titulo="Última pasada" tono={m.parado ? rojo : undefined}>
          {!m.registroDisponible ? 'No se sabe' : ultima ? `${hace(ahora, ultima.en)}${ultima.ok === false ? ' · con error' : ''}` : 'Ninguna registrada'}
        </Dato>
        <Dato titulo="Pasadas en la última hora" tono={m.fallosEnLaUltimaHora >= 5 ? rojo : undefined}>
          {m.registroDisponible ? `${m.pasadasEnLaUltimaHora} · ${m.fallosEnLaUltimaHora} con error` : '—'}
        </Dato>
        <Dato titulo="Último correo enviado">{m.ultimoEnvioAt ? hace(ahora, m.ultimoEnvioAt) : 'Ninguno todavía'}</Dato>
        <Dato titulo="Seguimientos atrasados" tono={m.atrasados >= 5 ? ambar : undefined}>
          {m.atrasados}
        </Dato>
        <Dato titulo="Envíos fallidos" tono={m.fallidos > 0 ? rojo : undefined}>
          {m.fallidos}
        </Dato>
        <Dato titulo="Respuestas sin leer por la IA" tono={m.iaFallidas > 0 ? ambar : undefined}>
          {m.iaFallidas}
          {m.iaPendientes > 0 ? ` · ${m.iaPendientes} esperando` : ''}
        </Dato>
      </dl>
      {!m.registroDisponible && (
        <p className="border-t border-[var(--ls-linea)] px-3 py-2 text-[11.5px] leading-snug text-[var(--ls-t4)]">
          No se puede leer el registro de procesos (falta lanzar la migración 137 en Supabase), así que no se sabe si el motor está corriendo. Lo demás se mide igual.
        </p>
      )}
      {m.ultimaPasada?.error && <p className="border-t border-[var(--ls-linea)] px-3 py-2 text-[11.5px] leading-snug text-[var(--ls-t3)]">Error de la última pasada: {m.ultimaPasada.error}</p>}
    </section>
  )
}

function ChipDeConexion({ b }: { b: SaludDelBuzon }) {
  const estado = b.conexion.estado
  const color = estado === 'ok' ? 'var(--ls-e-verde)' : estado === 'sin_sincronizar' || estado === 'sin_conectar' ? 'var(--ls-e-ambar)' : 'var(--ls-e-rojo)'
  const Icono = estado === 'ok' ? MailCheck : Plug
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] font-medium" style={{ color }}>
      <Icono className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{b.conexion.texto}</span>
    </span>
  )
}

function TarjetaDeBuzon({ b, ahora, indice }: { b: SaludDelBuzon; ahora: number; indice: number }) {
  const color = COLOR_DE_NIVEL[b.nivel]
  const hoy = b.hoy
  const uso = hoy && hoy.tope > 0 ? Math.min(1, hoy.enviados / hoy.tope) : 0
  // Con pocos envíos el porcentaje no dice nada (un rebote de cinco correos es un 20 %): no se colorea, como tampoco salta la alarma
  const colorDeRebotes = (v: { enviados: number; pct: number | null }) =>
    v.pct === null || v.enviados < b.minimoDeEnvios ? undefined : v.pct >= b.limiteDeRebotesPct ? COLOR_DE_GRAVEDAD.roja : v.pct >= b.limiteDeRebotesPct / 2 ? COLOR_DE_GRAVEDAD.ambar : undefined
  const r24 = b.rebotes24h
  const r7 = b.rebotes7d
  return (
    <Revelar i={indice}>
      <article className={`${PANEL} h-full`} style={{ borderLeft: `3px solid ${color}` }} aria-label={`Buzón de ${b.propietario}`}>
        <header className="flex items-center gap-2.5 border-b border-[var(--ls-linea)] px-3 py-2.5">
          <Avatar id={b.buzonId} nombre={b.propietario} tamano={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[var(--ls-t1)]">
              {b.propietario}
              {b.esMio ? ' (tú)' : ''}
            </p>
            <p className="truncate text-[11px] text-[var(--ls-t4)]">{b.direccion}</p>
          </div>
          {b.pausa ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-[color-mix(in_srgb,var(--ls-e-ambar)_14%,transparent)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--ls-e-ambar)]" title={b.pausa.motivo ?? undefined}>
              <Pause className="h-3 w-3" aria-hidden /> En pausa hasta {cuando(b.pausa.hasta, ahora)}
            </span>
          ) : !b.participa ? (
            <span className="shrink-0 rounded-[5px] bg-[var(--ls-sup3)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--ls-t3)]">No participa</span>
          ) : null}
        </header>

        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2">
            <ChipDeConexion b={b} />
          </div>
          {b.conexion.ultimoError && b.conexion.estado !== 'ok' && <p className="-mt-1.5 line-clamp-2 text-[11px] leading-snug text-[var(--ls-t4)]">{b.conexion.ultimoError}</p>}

          {hoy && (
            <div>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="text-[var(--ls-t3)]">Hoy</span>
                <span className="tabular-nums text-[var(--ls-t1)]">
                  <span className="font-semibold">{hoy.enviados}</span> de {hoy.tope}
                </span>
              </div>
              <div className="relative mt-1 h-[8px] overflow-hidden rounded-full bg-[var(--ls-sup3)]" role="img" aria-label={`${hoy.enviados} correos enviados hoy de un tope de ${hoy.tope}`}>
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${uso * 100}%`, background: uso >= 1 ? 'var(--ls-e-ambar)' : 'var(--ls-acc-graf)' }} />
              </div>
              <p className="mt-1 text-[11px] text-[var(--ls-t4)]">
                {hoy.manual} a mano · {hoy.automaticos} automáticos · {hoy.programados} por salir{uso >= 1 ? ' · tope alcanzado' : ''}
              </p>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Dato titulo="Rampa">{b.rampa.fija ? `Tope fijo de ${b.rampa.tope}` : `Día ${b.rampa.diaHabil} · tope ${b.rampa.tope}`}</Dato>
            <Dato titulo="Secuencias en marcha">{b.vivas}</Dato>
            <Dato titulo={`Rebotes en 24 h · límite ${porcentajeTexto(b.limiteDeRebotesPct)}`} tono={colorDeRebotes(r24)}>
              {r24.enviados === 0 ? 'Sin envíos' : `${r24.rebotes} de ${r24.enviados} (${porcentajeTexto(r24.pct ?? 0)})`}
            </Dato>
            <Dato titulo="Rebotes en 7 días" tono={colorDeRebotes(r7)}>
              {r7.enviados === 0 ? 'Sin envíos' : `${r7.rebotes} de ${r7.enviados} (${porcentajeTexto(r7.pct ?? 0)})`}
            </Dato>
          </dl>
        </div>
      </article>
    </Revelar>
  )
}

export function VistaDeSalud({ tablero, ahora }: { tablero: Tablero; ahora: number }) {
  const salud = tablero.salud
  return (
    <div className="space-y-3">
      <Veredicto salud={salud} />
      <ListaDeAlarmas salud={salud} />
      <PanelDelMotor salud={salud} ahora={ahora} />

      <section aria-label="Buzones">
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ls-t4)]">
          <HeartPulse className="h-3.5 w-3.5" aria-hidden /> Los buzones
        </h3>
        {salud.buzones.length === 0 ? (
          <p className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-8 text-center text-[12.5px] text-[var(--ls-t3)]">No hay ningún buzón que ver.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {salud.buzones.map((b, i) => (
              <TarjetaDeBuzon key={b.buzonId} b={b} ahora={ahora} indice={i} />
            ))}
          </div>
        )}
      </section>

      <details className={`${PANEL} group`}>
        <summary className="cursor-pointer select-none px-3 py-2.5 text-[12px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">Cuándo salta cada alarma</summary>
        <ul className="space-y-1.5 border-t border-[var(--ls-linea)] px-4 py-3 text-[12px] leading-snug text-[var(--ls-t3)]">
          <li>
            <strong className="font-semibold text-[var(--ls-t2)]">Motor parado:</strong> con el motor encendido, {duracionTexto(10 * 60_000)} sin ninguna pasada (un despliegue tarda unos 5 minutos, por eso no salta antes).
          </li>
          <li>
            <strong className="font-semibold text-[var(--ls-t2)]">Motor fallando:</strong> 5 o más pasadas con error en la última hora (roja si son la mitad o más).
          </li>
          <li>
            <strong className="font-semibold text-[var(--ls-t2)]">Buzón:</strong> contraseña rechazada (roja), 3 fallos seguidos de conexión (ámbar; roja con 6), o sin leerse su correo en {duracionTexto(30 * 60_000)}.
          </li>
          <li>
            <strong className="font-semibold text-[var(--ls-t2)]">Rebotes:</strong> con 20 envíos o más en un día, a partir de la mitad del límite (4 %) es ámbar; con el límite entero, roja y el motor pausa el buzón hasta el siguiente día hábil.
          </li>
          <li>
            <strong className="font-semibold text-[var(--ls-t2)]">Envíos fallidos:</strong> cualquier seguimiento que no haya podido salir y siga esperando a una persona.
          </li>
          <li>
            <strong className="font-semibold text-[var(--ls-t2)]">A la campana</strong> van las rojas (y la contraseña de un buzón que participa), a los administradores y al dueño del buzón. El mismo aviso no se repite hasta pasadas 12 horas.
          </li>
        </ul>
      </details>
    </div>
  )
}
