import { CalendarDays, CheckCircle2, CircleDashed, Link2Off, Loader2 } from 'lucide-react'
import { FUENTE_CUERPO, FUENTE_TITULO, fechaLarga } from '@/components/encaje/marca'
import type { PanelDelCliente, TareaDelPortal } from '@/lib/tareas-clientes/portal'

/**
 * LO QUE VE EL CLIENTE: la marca de Liberty Seller arriba y, debajo, en qué estamos trabajando para él (en curso, lo siguiente y lo que ya está hecho). Solo lectura, sin
 * estado ni interacción: un componente de servidor. Los colores van sueltos (no las variables del ERP) y las clases con el color entre corchetes, por lo mismo que la página
 * del encaje: esta pantalla no vive dentro del tema oscuro de la aplicación.
 */

const hoy = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })

function Cabecera({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <header className="bg-[#0E0E0E]">
      <div className="h-[5px] bg-[#F26212]" />
      <div className="mx-auto max-w-[980px] px-5 pb-7 pt-5 sm:px-8 sm:pb-9">
        <div className="flex items-center justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/logo.png" alt="Liberty Seller" className="h-[26px] w-auto" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#F26212]">Tu cuenta</span>
        </div>
        <h1 className="mt-7 text-[27px] leading-[1.15] text-[#FFFFFF] sm:text-[36px]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>{titulo}</h1>
        {subtitulo && <p className="mt-2 text-[14px] text-[#EDE6DC]">{subtitulo}</p>}
      </div>
    </header>
  )
}

function Fecha({ t, vencida }: { t: TareaDelPortal; vencida: boolean }) {
  const fin = t.fecha_fin ?? t.fecha_inicio
  if (!fin) return null
  return (
    <span className={`inline-flex items-center gap-1 text-[12.5px] ${vencida ? 'font-medium text-[#B3261E]' : 'text-[#5E5852]'}`}>
      <CalendarDays className="h-3.5 w-3.5" />
      {t.fecha_inicio && t.fecha_fin && t.fecha_fin !== t.fecha_inicio ? `${fechaLarga(t.fecha_inicio)} → ${fechaLarga(t.fecha_fin)}` : fechaLarga(fin)}
    </span>
  )
}

function Tarjeta({ t }: { t: TareaDelPortal }) {
  const vencida = t.fase !== 'hecho' && Boolean(t.fecha_fin ?? t.fecha_inicio) && (t.fecha_fin ?? t.fecha_inicio ?? '9') < hoy()
  return (
    <li className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="mt-px w-6 flex-shrink-0 text-center text-[17px] leading-6">{t.icono ?? ''}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-medium leading-snug text-[#141414] ${t.fase === 'hecho' ? 'text-[#5E5852] line-through decoration-[#B8AE9F]' : ''}`}>{t.titulo}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {t.departamento && <span className="rounded-md bg-[#F7F5F2] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#5E5852]">{t.departamento}</span>}
            <span className="text-[12.5px] text-[#8C857C]">{t.estado}</span>
            <Fecha t={t} vencida={vencida} />
          </div>
          {t.fase !== 'hecho' && t.progreso > 0 && (
            <div className="mt-2.5 flex items-center gap-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.progreso} aria-label="Avance">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EDE6DC]"><div className="h-full rounded-full bg-[#F26212]" style={{ width: `${t.progreso}%` }} /></div>
              <span className="w-9 text-right text-[12px] tabular-nums text-[#5E5852]">{t.progreso}%</span>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function Bloque({ titulo, icono, tareas, vacio, nota }: { titulo: string; icono: React.ReactNode; tareas: TareaDelPortal[]; vacio: string; nota?: string }) {
  return (
    <section className="mt-9">
      <h2 className="flex items-center gap-2 text-[17px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
        {icono}
        {titulo}
        <span className="rounded-full bg-[#EDE6DC] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[#5E5852]">{tareas.length}</span>
      </h2>
      {tareas.length === 0 ? <p className="mt-3 text-[14px] text-[#8C857C]">{vacio}</p> : <ul className="mt-3 flex flex-col gap-2">{tareas.map((t) => <Tarjeta key={t.id} t={t} />)}</ul>}
      {nota && <p className="mt-3 text-[12.5px] text-[#8C857C]">{nota}</p>}
    </section>
  )
}

export function PanelPublico({ panel }: { panel: PanelDelCliente }) {
  const nada = panel.enCurso.length + panel.pendientes.length + panel.hechas.length === 0
  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
      <Cabecera titulo={`${panel.cliente.icono ? `${panel.cliente.icono} ` : ''}${panel.cliente.nombre}`} subtitulo="En qué estamos trabajando para ti" />
      <main className="mx-auto max-w-[980px] px-5 pb-20 pt-2 sm:px-8">
        {nada ? (
          <div className="mt-10 rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-12 text-center">
            <p className="text-[15px] text-[#5E5852]">Todavía no hay nada que enseñarte aquí. En cuanto el equipo empiece con tu cuenta, lo verás en esta página.</p>
          </div>
        ) : (
          <>
            <Bloque titulo="En marcha" icono={<Loader2 className="h-4 w-4 text-[#F26212]" />} tareas={panel.enCurso} vacio="Ahora mismo no hay nada en marcha." />
            <Bloque titulo="Lo siguiente" icono={<CircleDashed className="h-4 w-4 text-[#8C857C]" />} tareas={panel.pendientes} vacio="No hay nada pendiente por empezar." />
            <Bloque titulo="Hecho" icono={<CheckCircle2 className="h-4 w-4 text-[#2F9657]" />} tareas={panel.hechas} vacio="Todavía no hay nada terminado." nota={panel.totalHechas > panel.hechas.length ? `Se muestran las ${panel.hechas.length} más recientes de ${panel.totalHechas}.` : undefined} />
          </>
        )}
        <p className="mt-14 text-center text-[12px] text-[#B8AE9F]">Liberty Seller · Esta página se actualiza sola cada vez que la abres.</p>
      </main>
    </div>
  )
}

/** Un enlace inventado, desactivado o cambiado: dice qué hacer y NADA más (ni de qué cliente era) */
export function PanelNoValido({ texto = 'Este enlace ya no está activo o no es correcto. Pídele a tu contacto en Liberty Seller que te mande el enlace actual.' }: { texto?: string }) {
  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
      <Cabecera titulo="Tu cuenta" />
      <main className="mx-auto max-w-[640px] px-5 pb-20 pt-10 sm:px-8">
        <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-12 text-center sm:px-12">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#FBEFE8] text-[#F26212]"><Link2Off className="h-8 w-8" /></span>
          <h2 className="mt-5 text-[24px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>Este enlace no se puede usar</h2>
          <p className="mx-auto mt-3 max-w-[440px] text-[14.5px] leading-relaxed text-[#5E5852]">{texto}</p>
        </div>
      </main>
    </div>
  )
}
