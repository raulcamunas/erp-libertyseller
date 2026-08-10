'use client'

import { useEffect } from 'react'
import { Loader2, X, type LucideIcon } from 'lucide-react'
import {
  AVISO,
  BOTON,
  COLOR_ESTADO,
  LINEA,
  RADIO,
  SUPERFICIE,
  TARJETA,
  TEXTO,
  TIPO,
  TITULO,
  type TonoEstado,
} from '@/lib/estilo/denso'
import { marketplaceById } from '@/lib/types/amazon'

/**
 * LAS PIEZAS QUE COMPARTEN LAS CUATRO PANTALLAS DE A1.
 *
 * Todo lo de aquí sale de lib/estilo/denso.ts. Ni un color suelto, ni un tamaño
 * escrito a ojo: el motivo está medido y escrito en la cabecera de ese fichero
 * —hoy el ERP tiene nueve mapas de estado distintos y dieciséis niveles de
 * opacidad de texto, y así es como se llega a que dos pantallas pinten el mismo
 * estado de dos colores.
 *
 * Estas pantallas NACEN con la densidad nueva (filas de 28 px) porque no hay
 * memoria muscular que romper: son la muestra de cómo va a quedar el ERP entero
 * cuando toque la migración de densidad de los veinte módulos que ya existen.
 */

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

/**
 * Un aviso con filo de color a la izquierda ADEMÁS del icono.
 *
 * Dos señales y no solo el tono: tapando el color con la mano el aviso se sigue
 * leyendo, que es lo que necesita el 8 % de los hombres que no distingue rojo de
 * verde.
 */
export function Aviso({
  tono,
  icono: Icono,
  children,
}: {
  tono: TonoEstado
  icono: LucideIcon
  children: React.ReactNode
}) {
  return (
    <div
      className={`${AVISO.base} ${AVISO.conTono}`}
      style={{ borderLeftColor: COLOR_ESTADO[tono] }}
    >
      <Icono className={AVISO.icono} style={{ color: COLOR_ESTADO[tono] }} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * LA PANTALLA VACÍA, que es la que más se va a ver los primeros días.
 *
 * No dice «no hay datos» y se calla. Dice QUÉ FALTA y QUÉ HAY QUE HACER, porque
 * un cliente recién conectado va a tener todas estas pantallas vacías durante la
 * primera noche entera y la diferencia entre «esto está roto» y «esto todavía no
 * ha corrido» son estas tres líneas.
 *
 * El icono se recibe YA CONSTRUIDO —`icono={<Inbox />}`, no `icono={Inbox}`—.
 * No es capricho: este fichero es 'use client' y media
 * pantalla vacía se pinta desde componentes de SERVIDOR. Un icono de lucide es
 * un objeto de forwardRef con una función `render` dentro, y una función no
 * cruza la frontera servidor→cliente: React corta el render con «Functions
 * cannot be passed directly to Client Components» y la página entera responde
 * 500. Ni `tsc` ni `next build` lo ven, porque el tipo era correcto: solo
 * reventaba al pintar. Con `React.ReactNode` el elemento ya está creado y viaja
 * serializado, y de paso el compilador rechaza la forma vieja.
 *
 * El tamaño y el color se quedan aquí para que las treinta pantallas vacías no
 * los repitan (y no los repitan mal).
 */
export function Vacio({
  icono,
  titulo,
  children,
  accion,
}: {
  icono: React.ReactNode
  titulo: string
  children?: React.ReactNode
  accion?: React.ReactNode
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 py-10 text-center ${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup}`}
    >
      <span className="text-[var(--ls-t4)] [&>svg]:h-5 [&>svg]:w-5">{icono}</span>
      <p className={TITULO.seccion}>{titulo}</p>
      {children && <div className={`${TIPO.s} ${TEXTO.t3} max-w-[52ch]`}>{children}</div>}
      {accion}
    </div>
  )
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className={`flex items-center gap-[6px] px-1 py-2 ${TIPO.s} ${TEXTO.t3}`}>
      <Loader2 className="h-3 w-3 animate-spin" />
      {texto}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cobertura: la barra                                                 */
/* ------------------------------------------------------------------ */

/**
 * Una barra de cobertura con su fracción al lado.
 *
 * SIEMPRE SE ENSEÑA LA FRACCIÓN, no solo el porcentaje. «100 %» sobre cinco SKU
 * y «100 %» sobre trece mil son la misma cifra y no son la misma noticia, y esta
 * pantalla existe justo para decidir de qué fiarse.
 *
 * El color no lo pone la barra: lo pone quien la usa, porque «poco» significa
 * cosas distintas según el dato. Un 60 % de dimensiones certificadas es un
 * problema; un 60 % de inventario leído en un catálogo mitad FBM es lo normal.
 */
export function Barra({
  valor,
  total,
  tono = 'azul',
  titulo,
}: {
  valor: number
  total: number
  tono?: TonoEstado
  titulo?: string
}) {
  const parte = total > 0 ? Math.max(0, Math.min(1, valor / total)) : 0
  return (
    <span className="flex items-center gap-[6px] min-w-0" title={titulo}>
      <span
        className={`h-[6px] w-full min-w-[40px] max-w-[120px] overflow-hidden ${RADIO.r1} bg-[var(--ls-sup3)]`}
      >
        <span
          className="block h-full"
          style={{ width: `${parte * 100}%`, backgroundColor: COLOR_ESTADO[tono] }}
        />
      </span>
      <span className={`${TIPO.xs} ${TEXTO.t2} shrink-0 tabular-nums`}>
        {total > 0 ? `${Math.round(parte * 100)}%` : '—'}
      </span>
      <span className={`${TIPO.s} ${TEXTO.t4} shrink-0 tabular-nums`}>
        {cifra(valor)}/{cifra(total)}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Tarjeta con cabecera                                                */
/* ------------------------------------------------------------------ */

export function Panel({
  titulo,
  derecha,
  children,
  sinCuerpo,
}: {
  titulo: React.ReactNode
  derecha?: React.ReactNode
  children: React.ReactNode
  /** Para meter una tabla a sangre, sin el relleno del cuerpo */
  sinCuerpo?: boolean
}) {
  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={`${TITULO.seccion} truncate`}>{titulo}</h2>
        {derecha && <div className="ml-auto flex shrink-0 items-center gap-[6px]">{derecha}</div>}
      </header>
      {sinCuerpo ? children : <div className={TARJETA.cuerpo}>{children}</div>}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Diálogo                                                             */
/* ------------------------------------------------------------------ */

/**
 * El diálogo de las pantallas nuevas.
 *
 * Escrito a mano y no con Radix, por lo mismo que components/amazon/Dialogo.tsx:
 * son cuarenta líneas, no arrastra dependencia y la estética la pone denso.ts
 * entera. Lo único que hay que acordarse de hacer —y por eso está aquí y no
 * copiado en cada sitio— es cerrar con Escape y no dejar la página de debajo
 * haciendo scroll.
 */
export function Dialogo({
  titulo,
  entradilla,
  onCerrar,
  children,
  pie,
  ancho = 'max-w-[520px]',
}: {
  titulo: string
  entradilla?: React.ReactNode
  onCerrar: () => void
  children: React.ReactNode
  pie?: React.ReactNode
  ancho?: string
}) {
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alPulsar)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', alPulsar)
      document.body.style.overflow = antes
    }
  }, [onCerrar])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar()
      }}
    >
      <div
        className={`w-full ${ancho} ${RADIO.r3} border ${LINEA.fuerte} ${SUPERFICIE.sup} shadow-2xl`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <header
          className={`flex h-[30px] items-center gap-2 px-[10px] border-b ${LINEA.normal}`}
        >
          <h2 className={`${TITULO.seccion} truncate`}>{titulo}</h2>
          <button type="button" onClick={onCerrar} className={`${BOTON.icono} ml-auto`} aria-label="Cerrar">
            <X className="h-[13px] w-[13px]" />
          </button>
        </header>

        <div className="px-[10px] py-[9px] space-y-2">
          {entradilla && <p className={TITULO.entradilla}>{entradilla}</p>}
          {children}
        </div>

        {pie && (
          <footer
            className={`flex items-center justify-end gap-[6px] px-[10px] py-[9px] border-t ${LINEA.normal}`}
          >
            {pie}
          </footer>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

/** El nombre del país, no su identificador. `A1RKKUPIHCS9HS` no le dice nada a
    nadie, y la tabla de marketplaces es un parámetro, nunca una constante */
export function nombreMarketplace(id: string | null): string {
  if (!id) return '—'
  return marketplaceById(id)?.label ?? id
}

export function cifra(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('es-ES')
}

export function dinero(valor: number | null, moneda: string | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  try {
    return valor.toLocaleString('es-ES', {
      style: 'currency',
      currency: moneda || 'EUR',
      maximumFractionDigits: 2,
    })
  } catch {
    // Una divisa que Intl no conoce no puede tumbar la tabla entera.
    return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${moneda ?? ''}`.trim()
  }
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

/**
 * «hace 4 h», «hace 3 días».
 *
 * Se usa junto a la fecha exacta, nunca en su lugar: «hace 20 h» contesta rápido
 * «¿esto está al día?», pero para saber si el barrido entró en la ventana
 * nocturna hace falta la hora. Las dos cosas, no una.
 */
export function hace(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const segundos = Math.floor((Date.now() - d.getTime()) / 1000)
  if (segundos < 0) return 'ahora'
  if (segundos < 60) return 'hace un momento'
  if (segundos < 3600) return `hace ${Math.floor(segundos / 60)} min`
  if (segundos < 86400) return `hace ${Math.floor(segundos / 3600)} h`
  const dias = Math.floor(segundos / 86400)
  if (dias === 1) return 'hace 1 día'
  if (dias < 45) return `hace ${dias} días`
  return `hace ${Math.floor(dias / 30)} meses`
}

/** Cuántos días lleva sin pasar algo. null cuando no ha pasado nunca */
export function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

/**
 * Cuánto ha durado algo, en la unidad que se lea de un vistazo.
 *
 * `fin` a null significa que sigue en marcha, y entonces se cuenta hasta ahora:
 * un trabajo que lleva cuarenta minutos corriendo tiene una duración, y no
 * enseñarla es justo lo que hace imposible distinguir «va lento» de «está
 * colgado».
 */
export function duracion(inicio: string | null | undefined, fin?: string | null): string {
  if (!inicio) return '—'
  const a = new Date(inicio).getTime()
  if (Number.isNaN(a)) return '—'
  const b = fin ? new Date(fin).getTime() : Date.now()
  if (Number.isNaN(b)) return '—'

  const seg = Math.max(0, Math.round((b - a) / 1000))
  // Por debajo del minuto con un decimal: la diferencia entre 0,1 s y 14,4 s es
  // la que dice si una pasada ha hecho algo o ha contestado «no toca».
  if (seg < 60) return `${((b - a) / 1000).toFixed(1)} s`
  if (seg < 3600) {
    const m = Math.floor(seg / 60)
    const s = seg % 60
    return s === 0 ? `${m} min` : `${m} min ${s} s`
  }
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/**
 * Cuándo le toca otra vez, dada la última vez y cada cuánto.
 *
 * Devuelve «le toca ya» cuando la fecha ya ha pasado, y no una cuenta atrás en
 * negativo: un «hace -3 min» no lo lee nadie, y lo que se quiere saber es si
 * está pendiente o no.
 */
export function proxima(ultimo: string | null | undefined, cadaMinutos: number): string {
  if (!ultimo) return 'en cuanto pueda'
  const t = new Date(ultimo).getTime()
  if (Number.isNaN(t)) return '—'
  const cuando = t + cadaMinutos * 60_000
  const faltan = Math.round((cuando - Date.now()) / 60_000)
  if (faltan <= 0) return 'le toca ya'
  if (faltan < 60) return `en ${faltan} min`
  const horas = Math.round(faltan / 60)
  if (horas < 48) return `en ${horas} h`
  return `en ${Math.round(horas / 24)} días`
}
