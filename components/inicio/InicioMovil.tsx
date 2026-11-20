'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react'
import { Check, ChevronDown, LayoutGrid, Pin, Search, X } from 'lucide-react'
import { getAppById, GRUPOS_DEL_MENU, nombreCortoDe, type AppConfig } from '@/lib/config/apps'
import { armarMenu } from '@/lib/layout/menu'
import { cuantasApps, fechaEnPalabras, saludoDe } from '@/lib/inicio/saludo'
import { leerChatSinLeer, leerCorreoSinLeer, leerWebLeadsSinVer, suscribirContadores } from '@/lib/avisos/contadores'
import { buscarApps } from '@/lib/movil/buscar'
import { avisarNavegando } from '@/lib/movil/eventos'
import { EVENTO_USO_CAMBIA, fijadas as leerFijadas, fijar, leerUso, MAX_FIJADAS, ordenarRecientes, soltar } from '@/lib/movil/uso'
import { cn } from '@/lib/utils'

/**
 * EL INICIO EN EL MÓVIL: una pantalla de iconos, como la del teléfono, en vez de la columna de tarjetas grandes del escritorio (con 30 aplicaciones,
 * eran casi nueve pantallas de scroll; así caben en menos de dos).
 *
 *   · Arriba, el saludo en pequeño y un buscador (con Intro se abre la primera que sale).
 *   · «Recientes»: las cuatro últimas que se abrieron en este navegador (lib/movil/uso.ts).
 *   · Después, las secciones del MISMO menú lateral (lib/layout/menu.ts): «Tus apps» con las sueltas y un bloque por desplegable (Contabilidad,
 *     Herramientas Agencia…). Cada sección se pliega y se acuerda.
 *   · «Editar barra»: tocar un icono lo fija (o lo quita) en la barra de abajo; caben tres.
 *
 * Solo pinta. Qué aplicaciones ve cada persona lo decide el servidor (app/dashboard/page.tsx) y aquí llegan solo sus ids: un icono es un componente y no
 * puede viajar del servidor al navegador, así que se buscan aquí con getAppById. Se ve solo por debajo de `lg` (lo esconde InicioApps).
 */

const CLAVE_PLEGADAS = 'erp:movil:secciones-plegadas'

interface Seccion {
  id: string
  titulo: string
  apps: AppConfig[]
}

export function InicioMovil({ ids, nombre, className }: { ids: readonly string[]; nombre: string; rol?: string; className?: string }) {
  const router = useRouter()
  const apps = useMemo(() => ids.map((id) => getAppById(id)).filter((a): a is AppConfig => Boolean(a)), [ids])

  // La hora del navegador (el servidor no sabe en qué zona está quien mira)
  const [ahora, setAhora] = useState<Date | null>(null)
  useEffect(() => setAhora(new Date()), [])

  // Recientes y fijadas: del almacenamiento de este navegador, después de montar (en el servidor no hay)
  const [recientesIds, setRecientes] = useState<string[]>([])
  const [fijadasIds, setFijadas] = useState<string[]>([])
  useEffect(() => {
    const leer = () => {
      setRecientes(ordenarRecientes(leerUso(), 4, ids))
      setFijadas(leerFijadas())
    }
    leer()
    window.addEventListener(EVENTO_USO_CAMBIA, leer)
    return () => window.removeEventListener(EVENTO_USO_CAMBIA, leer)
  }, [ids])

  const [plegadas, setPlegadas] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    try {
      const crudo: unknown = JSON.parse(window.localStorage.getItem(CLAVE_PLEGADAS) ?? '[]')
      if (Array.isArray(crudo)) setPlegadas(new Set(crudo.filter((x): x is string => typeof x === 'string')))
    } catch {
      /* un valor roto no rompe el Inicio */
    }
  }, [])
  const alternar = (id: string) => {
    const n = new Set(plegadas)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setPlegadas(n)
    try {
      window.localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify([...n]))
    } catch {
      /* sin almacenamiento: no se acuerda, nada más */
    }
  }

  const [consulta, setConsulta] = useState('')
  const [editando, setEditando] = useState(false)
  const [nota, setNota] = useState('')

  // Las insignias, del mismo sitio que las del menú lateral
  const correo = useSyncExternalStore(suscribirContadores, leerCorreoSinLeer, () => 0)
  const chat = useSyncExternalStore(suscribirContadores, leerChatSinLeer, leerChatSinLeer)
  const webLeads = useSyncExternalStore(suscribirContadores, leerWebLeadsSinVer, () => 0)
  const insigniaDe = (id: string): { texto: string; urgente?: boolean } | null => {
    const n = id === 'correo' ? correo : id === 'chat' ? chat.mensajes + chat.menciones : id === 'web-leads' ? webLeads : 0
    if (n <= 0) return null
    return { texto: n > 99 ? '99+' : String(n), urgente: id === 'chat' && chat.menciones > 0 }
  }

  // Las secciones: las del menú lateral, en su orden
  const { secciones, grupoDe } = useMemo(() => {
    const menu = armarMenu(apps, GRUPOS_DEL_MENU)
    const sueltas: AppConfig[] = []
    const grupos: Seccion[] = []
    const grupoDe = new Map<string, string>()
    for (const e of menu) {
      if (e.tipo === 'app') sueltas.push(e.app)
      else {
        grupos.push({ id: e.grupo.id, titulo: e.grupo.name, apps: e.apps })
        for (const a of e.apps) grupoDe.set(a.id, e.grupo.name)
      }
    }
    const secciones: Seccion[] = [...(sueltas.length > 0 ? [{ id: 'tus-apps', titulo: 'Tus apps', apps: sueltas }] : []), ...grupos]
    return { secciones, grupoDe }
  }, [apps])

  const resultados = useMemo(() => {
    if (consulta.trim() === '') return null
    return buscarApps(
      apps.map((a) => ({ ...a, grupo: grupoDe.get(a.id) })),
      consulta,
    )
  }, [apps, consulta, grupoDe])

  const recientes = recientesIds.map((id) => apps.find((a) => a.id === id)).filter((a): a is AppConfig => Boolean(a))

  const alPulsar = (app: AppConfig) => {
    if (editando) {
      if (fijadasIds.includes(app.id)) {
        setFijadas(soltar(app.id))
        setNota(`${nombreCortoDe(app)} ya no está en la barra`)
      } else {
        const antes = fijadasIds
        const nuevas = fijar(app.id)
        setFijadas(nuevas)
        const sale = antes.find((x) => !nuevas.includes(x))
        const salida = sale ? apps.find((a) => a.id === sale) : undefined
        setNota(salida ? `${nombreCortoDe(app)} en la barra; sale ${nombreCortoDe(salida)} (caben ${MAX_FIJADAS})` : `${nombreCortoDe(app)} fijada en la barra`)
      }
      return
    }
    avisarNavegando(app.route)
  }

  const alBuscar = (e: FormEvent) => {
    e.preventDefault()
    const primera = resultados?.[0]
    if (!primera) return
    avisarNavegando(primera.route)
    router.push(primera.route)
  }

  const celda = (app: AppConfig, i: number) => {
    const Icono = app.icon
    const insignia = insigniaDe(app.id)
    const fijada = fijadasIds.includes(app.id)
    const contenido = (
      <>
        <span className="im-icono">
          <Icono aria-hidden />
          {insignia && !editando && (
            <span className="im-insignia" data-urgente={insignia.urgente ? 'true' : undefined} aria-hidden>
              {insignia.texto}
            </span>
          )}
          {editando && (
            <span className="im-pin" data-fijada={fijada ? 'true' : undefined} aria-hidden>
              {fijada ? <Check /> : <Pin />}
            </span>
          )}
        </span>
        <span className="im-nombre">{nombreCortoDe(app)}</span>
      </>
    )
    const estilo = { '--i': Math.min(i, 16) } as CSSProperties
    const etiqueta = `${app.name}${insignia ? `, ${insignia.texto} sin leer` : ''}`
    if (editando) {
      return (
        <button key={app.id} type="button" className="im-celda" style={estilo} onClick={() => alPulsar(app)} aria-pressed={fijada} aria-label={`${app.name}: ${fijada ? 'quitar de la barra' : 'fijar en la barra'}`}>
          {contenido}
        </button>
      )
    }
    return (
      <Link key={app.id} href={app.route} className="im-celda" style={estilo} onClick={() => alPulsar(app)} aria-label={etiqueta}>
        {contenido}
      </Link>
    )
  }

  return (
    <div className={cn('inicio-movil', className)}>
      <header className="im-cabecera">
        <h1 className="im-saludo">
          {ahora ? (
            <>
              {saludoDe(ahora.getHours())}
              {nombre ? ', ' : ''}
              {nombre && <span className="im-acento">{nombre}</span>}
            </>
          ) : (
            <span className="invisible" aria-hidden>
              Buenas tardes{nombre ? `, ${nombre}` : ''}
            </span>
          )}
        </h1>
        <p className="im-meta">
          {ahora ? fechaEnPalabras(ahora) : ' '} · {cuantasApps(apps.length)}
        </p>
      </header>

      <form className="im-buscador" role="search" onSubmit={alBuscar}>
        <Search className="im-buscador-lupa" aria-hidden />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Buscar una aplicación"
          aria-label="Buscar una aplicación"
        />
        {consulta && (
          <button type="button" className="im-buscador-borrar" onClick={() => setConsulta('')} aria-label="Borrar la búsqueda">
            <X aria-hidden />
          </button>
        )}
      </form>

      {apps.length === 0 ? (
        <div className="inicio-vacio">
          <LayoutGrid className="h-6 w-6" aria-hidden />
          <p>Todavía no tienes aplicaciones asignadas. Pídele a quien te dio la cuenta que te dé acceso.</p>
        </div>
      ) : resultados ? (
        <section className="im-seccion" aria-label="Resultados de la búsqueda">
          {resultados.length === 0 ? (
            <p className="im-sin-resultados">Ninguna aplicación se llama así.</p>
          ) : (
            <div className="im-rejilla">{resultados.map((a, i) => celda(a, i))}</div>
          )}
        </section>
      ) : (
        <>
          <div className="im-barra-edicion">
            {editando ? (
              <p className="im-edicion-ayuda" role="status" aria-live="polite">
                {nota || `Toca hasta ${MAX_FIJADAS} aplicaciones para tenerlas en la barra de abajo.`}
              </p>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="im-editar"
              data-activo={editando ? 'true' : undefined}
              aria-pressed={editando}
              onClick={() => {
                setEditando(!editando)
                setNota('')
              }}
            >
              {editando ? 'Hecho' : 'Editar barra'}
            </button>
          </div>

          {recientes.length > 0 && !editando && (
            <section className="im-seccion" aria-labelledby="im-recientes">
              <h2 id="im-recientes" className="im-titulo-fijo">
                Recientes
              </h2>
              <div className="im-rejilla">{recientes.map((a, i) => celda(a, i))}</div>
            </section>
          )}

          {secciones.map((s, n) => {
            const plegada = plegadas.has(s.id)
            return (
              <section key={s.id} className="im-seccion" style={{ '--n': n } as CSSProperties}>
                <h2>
                  <button type="button" className="im-titulo" aria-expanded={!plegada} aria-controls={`im-s-${s.id}`} onClick={() => alternar(s.id)}>
                    <span>{s.titulo}</span>
                    <span className="im-cuenta">{s.apps.length}</span>
                    <ChevronDown className="im-chevron" aria-hidden />
                  </button>
                </h2>
                {!plegada && (
                  <div id={`im-s-${s.id}`} className="im-rejilla">
                    {s.apps.map((a, i) => celda(a, i))}
                  </div>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
