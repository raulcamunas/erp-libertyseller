'use client'

import { Activity, Bot, CalendarClock, Cpu, Lock, RefreshCw, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react'
import { Boton, haceCuanto, Insignia, mezcla, Tarjeta, TACTIL } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import type { ModoDelMotor } from '@/lib/ads/motor'
import type { EstadoDelMotor as Estado } from '@/lib/ads/motor-estado'
import type { EstadoDeTerminos } from '@/lib/ads/terminos'
import { entero } from '../formato'

/** Los modos que se eligen AQUÍ. El modo «agente» no está: se enciende y se apaga desde la pestaña «Agente» (el servidor rechaza ponerlo desde aquí) */
export const MODOS: Array<{ id: ModoDelMotor; nombre: string; texto: string; aplica: boolean; tono: TonoEstado }> = [
  { id: 'apagado', nombre: 'Apagado', texto: 'No lee nada ni propone nada.', aplica: false, tono: 'gris' },
  { id: 'sugiere', nombre: 'Solo sugiere', texto: 'Propone y lo enseña aquí. No toca Amazon.', aplica: false, tono: 'azul' },
  { id: 'aprueba', nombre: 'Aprueba y aplica', texto: 'Aplica lo que una persona aprueba. Todo se deshace.', aplica: true, tono: 'verde' },
  { id: 'autopiloto', nombre: 'Autopiloto de negativas', texto: 'Excluye solo lo que gasta sin vender, con tope diario.', aplica: true, tono: 'naranja' },
]

/** Cómo se enseña el modo «agente» (no se elige aquí) */
export const MODO_AGENTE: (typeof MODOS)[number] = { id: 'agente', nombre: 'Agente PPC', texto: 'El agente decide y aplica solo, con topes, rampa y freno.', aplica: true, tono: 'verde' }

const fechaCorta = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const hora = (iso: string) => new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * EL ESTADO DEL MOTOR, a la vista: en qué modo está (y quién puede cambiarlo), de cuándo son los términos, cuándo se generaron las propuestas, qué va a pasar ahora y
 * cómo va el proceso de fondo. Cambiar el modo es solo de administradores (el servidor también lo comprueba).
 */
export function EstadoDelMotor({
  modo,
  firmada,
  esAdmin,
  terminos,
  motor,
  ocupado,
  topeAutopiloto,
  onModo,
  onActualizarTerminos,
  onRevisar,
  irA,
}: {
  modo: ModoDelMotor
  firmada: boolean
  esAdmin: boolean
  terminos: EstadoDeTerminos
  motor: Estado | undefined
  ocupado: string | null
  topeAutopiloto: number
  onModo: (m: ModoDelMotor) => void
  onActualizarTerminos: () => void
  onRevisar: () => void
  irA: (pestana: string) => void
}) {
  const esAgente = modo === 'agente'
  const actual = esAgente ? MODO_AGENTE : (MODOS.find((m) => m.id === modo) ?? MODOS[0])
  const proceso = motor?.proceso
  const tonoProceso: TonoEstado = proceso?.apagado ? 'gris' : proceso?.ok === false ? 'rojo' : proceso?.ultimaAt ? 'verde' : 'gris'

  return (
    <Tarjeta
      variante="destacada"
      acento="marketing"
      icono={Cpu}
      titulo="Motor de optimización"
      subtitulo={actual.texto}
      acciones={
        <Insignia tono={actual.tono} vivo={modo !== 'apagado'} variante="suave">
          {actual.nombre}
        </Insignia>
      }
    >
      {/* ---- el modo (con el agente encendido no hay selector: lo gobierna su pestaña) ---- */}
      {esAgente ? (
        <div className="flex flex-col gap-2 rounded-[12px] border px-3 py-[10px] sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: mezcla(COLOR_ESTADO.verde, 40), background: mezcla(COLOR_ESTADO.verde, 8) }}>
          <p className="flex min-w-0 items-start gap-2 text-[12.5px] leading-[1.45] text-[var(--ls-t2)]">
            <Bot className="mt-[2px] h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.verde }} aria-hidden />
            <span>
              <strong className="text-[var(--ls-t1)]">Modo agente: lo gobierna la pestaña Agente.</strong> El agente aplica él mismo estas propuestas; las que retiene esperan a una persona. Para cambiar de modo, apágalo desde allí.
            </span>
          </p>
          <Boton variante="secundario" tamano="sm" icono={Bot} onClick={() => irA('agente')}>
            Ir al agente
          </Boton>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="Modo del motor">
          {MODOS.map((m) => {
            const activo = m.id === modo
            const bloqueadoPorFirma = m.aplica && !firmada
            const desactivado = !esAdmin || ocupado !== null || bloqueadoPorFirma
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={activo}
                disabled={desactivado && !activo}
                onClick={() => !activo && !desactivado && onModo(m.id)}
                title={!esAdmin ? 'Solo un administrador cambia el modo del motor.' : bloqueadoPorFirma ? 'Para aplicar cambios, la ficha de cuenta tiene que estar firmada.' : m.texto}
                className={`group relative min-h-[64px] overflow-hidden rounded-[12px] border px-3 py-[10px] text-left transition-[background,border-color,transform] duration-200 ${TACTIL} ${activo ? 'border-transparent' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] enabled:hover:-translate-y-[1px] enabled:hover:border-[var(--ls-linea2)]'} disabled:cursor-not-allowed disabled:opacity-55`}
                style={activo ? { background: `linear-gradient(160deg, ${mezcla(COLOR_ESTADO[m.tono], 22)}, ${mezcla(COLOR_ESTADO[m.tono], 6)})`, boxShadow: `inset 0 0 0 1px ${mezcla(COLOR_ESTADO[m.tono], 45)}` } : undefined}
              >
                <span className="flex items-center gap-[6px] text-[13px] font-semibold" style={{ color: activo ? COLOR_ESTADO[m.tono] : 'var(--ls-t1)' }}>
                  {bloqueadoPorFirma || (!esAdmin && !activo) ? <Lock className="h-3 w-3" aria-hidden /> : null}
                  {m.nombre}
                </span>
                <span className="mt-[2px] block text-[11.5px] leading-[1.35] text-[var(--ls-t3)]">{m.texto}</span>
              </button>
            )
          })}
        </div>
      )}
      {!esAdmin && !esAgente && <p className="mt-2 flex items-center gap-[6px] text-[12px] text-[var(--ls-t3)]"><ShieldCheck className="h-3 w-3" aria-hidden /> Cambiar el modo, la ficha y los umbrales es cosa de un administrador. Tú puedes aplicar, ensayar y descartar propuestas.</p>}
      {!firmada && (
        <p className="mt-2 text-[12.5px]" style={{ color: COLOR_ESTADO.ambar }}>
          La ficha de cuenta no está firmada: el motor propone, pero no se puede aplicar nada (sí ensayar).{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => irA('ficha')}>
            Ir a la ficha
          </button>
        </p>
      )}
      {modo === 'autopiloto' && <p className="mt-2 text-[12.5px] text-[var(--ls-t3)]">El autopiloto excluye como mucho <strong className="text-[var(--ls-t1)]">{topeAutopiloto} términos al día</strong>, solo en campañas con la nomenclatura del SOP y nunca los marcados «Revisar» ni fichas de producto (ASIN).</p>}

      {/* ---- el estado: datos, generación, próximo paso, proceso ---- */}
      {modo !== 'apagado' && (
        <div className="mt-4 grid gap-3 border-t border-[var(--ls-linea)] pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <Dato icono={ScanSearch} titulo="Términos de búsqueda">
            {terminos.actualizadoAt ? (
              <>
                {terminos.desde && terminos.hasta ? `${fechaCorta(terminos.desde)} – ${fechaCorta(terminos.hasta)}` : ''} · {entero(terminos.filas)} con clics
                <span className="block text-[var(--ls-t4)]">leídos {haceCuanto(terminos.actualizadoAt)}</span>
              </>
            ) : terminos.sincronizando ? (
              'Amazon los está preparando…'
            ) : (
              'Todavía sin leer'
            )}
            {terminos.error && <span className="block" style={{ color: COLOR_ESTADO.ambar }}>Última lectura fallida: {terminos.error}</span>}
          </Dato>
          <Dato icono={Sparkles} titulo="Última generación">
            {motor?.generadoAt ? <>Propuestas generadas {haceCuanto(motor.generadoAt)}</> : 'Sin dato (se apunta desde la migración 311)'}
          </Dato>
          <Dato icono={CalendarClock} titulo="Próximo paso">
            {motor?.proximoPaso ?? '—'}
            {motor?.proximoAt && <span className="block text-[var(--ls-t4)]">{hora(motor.proximoAt)}</span>}
          </Dato>
          <Dato icono={Activity} titulo="Proceso de fondo" tono={tonoProceso}>
            {proceso?.apagado ? (
              'Apagado desde Sistema: el motor no avanza solo.'
            ) : proceso?.ultimaAt ? (
              <>
                {proceso.ok === false ? 'Falló' : 'Bien'} · última pasada con trabajo {haceCuanto(proceso.ultimaAt)}
                {(proceso.error || proceso.resumen) && <span className="block truncate text-[var(--ls-t4)]" title={proceso.error ?? proceso.resumen ?? ''}>{proceso.error ?? proceso.resumen}</span>}
              </>
            ) : (
              'Sin pasadas registradas todavía'
            )}
          </Dato>
        </div>
      )}

      {modo !== 'apagado' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Boton variante="secundario" tamano="sm" icono={RefreshCw} disabled={ocupado !== null || terminos.sincronizando} cargando={ocupado === 'terminos'} onClick={onActualizarTerminos} title="Pide a Amazon el informe de términos ahora. Lo recoge el proceso de fondo, que genera las propuestas en cuanto llega">
            Pedir términos ahora
          </Boton>
          <Boton variante="secundario" tamano="sm" icono={Bot} disabled={ocupado !== null} cargando={ocupado === 'generar'} onClick={onRevisar} title="Vuelve a pasar las reglas con los datos guardados (no pide nada nuevo a Amazon)">
            Revisar ahora
          </Boton>
        </div>
      )}
    </Tarjeta>
  )
}

function Dato({ icono: Icono, titulo, tono, children }: { icono: typeof Cpu; titulo: string; tono?: TonoEstado; children: React.ReactNode }) {
  const color = tono ? COLOR_ESTADO[tono] : 'var(--ls-t3)'
  return (
    <div className="flex min-w-0 gap-[10px]">
      <span className="mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ background: mezcla(tono ? color : 'var(--ls-acc)', 12), color: tono ? color : 'var(--ls-acc)' }}>
        <Icono className="h-[14px] w-[14px]" aria-hidden />
      </span>
      <div className="min-w-0 text-[12.5px] leading-[1.45] text-[var(--ls-t2)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">{titulo}</div>
        {children}
      </div>
    </div>
  )
}
