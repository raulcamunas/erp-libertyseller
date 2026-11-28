'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Globe, Home, LayoutGrid, Mail, Menu, MessagesSquare, PenLine, Pin, Plus, Search, X } from 'lucide-react'
import { getAppById, gruposDelMenuPara, nombreCortoDe, type AppConfig } from '@/lib/config/apps'
import { armarMenu } from '@/lib/layout/menu'
import { cuantasApps, fechaEnPalabras, saludoDe } from '@/lib/inicio/saludo'
import { leerChatSinLeer, leerCorreoSinLeer, leerWebLeadsSinVer, suscribirContadores } from '@/lib/avisos/contadores'
import { buscarApps } from '@/lib/movil/buscar'
import { avisarNavegando } from '@/lib/movil/eventos'
import { EVENTO_USO_CAMBIA, fijadas as leerFijadas, fijar, leerUso, MAX_FIJADAS, moverFijada, ordenarRecientes, ponerSoloFijadas, soloFijadas as leerSoloFijadas, soltar } from '@/lib/movil/uso'
import { cn } from '@/lib/utils'
import { COLORES_DE_SECCION } from '@/lib/inicio/colores'

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
/** El color de cada sección (en orden): así no es un muro de iconos naranjas iguales y se encuentra antes cada grupo (el mismo que en el ordenador) */
const COLORES = COLORES_DE_SECCION

interface Seccion {
  id: string
  titulo: string
  apps: AppConfig[]
}

export function InicioMovil({ ids, nombre, className, puesto }: { ids: readonly string[]; nombre: string; rol?: string; className?: string; puesto?: string | null }) {
  const router = useRouter()
  const apps = useMemo(() => ids.map((id) => getAppById(id)).filter((a): a is AppConfig => Boolean(a)), [ids])

  // La hora del navegador (el servidor no sabe en qué zona está quien mira)
  const [ahora, setAhora] = useState<Date | null>(null)
  useEffect(() => setAhora(new Date()), [])

  // Recientes y fijadas: del almacenamiento de este navegador, después de montar (en el servidor no hay)
  const [recientesIds, setRecientes] = useState<string[]>([])
  const [fijadasIds, setFijadas] = useState<string[]>([])
  const [solo, setSolo] = useState(false)
  useEffect(() => {
    const leer = () => {
      setRecientes(ordenarRecientes(leerUso(), 8, ids))
      setFijadas(leerFijadas())
      setSolo(leerSoloFijadas())
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
    const menu = armarMenu(apps, gruposDelMenuPara(puesto))
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
  }, [apps, puesto])

  // El color de cada app: el de su sección
  const colorDe = useMemo(() => {
    const m = new Map<string, string>()
    secciones.forEach((sec, n) => sec.apps.forEach((a) => m.set(a.id, COLORES[n % COLORES.length])))
    return m
  }, [secciones])

  const resultados = useMemo(() => {
    if (consulta.trim() === '') return null
    return buscarApps(
      apps.map((a) => ({ ...a, grupo: grupoDe.get(a.id) })),
      consulta,
    )
  }, [apps, consulta, grupoDe])

  const recientes = recientesIds.map((id) => apps.find((a) => a.id === id)).filter((a): a is AppConfig => Boolean(a))

  const pendientes = (
    [
      { id: 'correo', n: correo, texto: 'Correos', icono: Mail, urgente: false },
      { id: 'chat', n: chat.mensajes + chat.menciones, texto: chat.menciones > 0 ? 'Te mencionan' : 'Chat', icono: MessagesSquare, urgente: chat.menciones > 0 },
      { id: 'web-leads', n: webLeads, texto: 'Leads web', icono: Globe, urgente: false },
    ] as const
  )
    .map((p) => ({ ...p, app: apps.find((a) => a.id === p.id) }))
    .filter((p): p is typeof p & { app: AppConfig } => Boolean(p.app) && p.n > 0)

  const alPulsar = (app: AppConfig) => {
    if (editando) {
      if (fijadasIds.includes(app.id)) {
        setFijadas(soltar(app.id))
        setNota(`${nombreCortoDe(app)} ya no está en la barra`)
      } else if (fijadasIds.length >= MAX_FIJADAS) {
        setNota(`La barra está llena (caben ${MAX_FIJADAS}): quita una con la × antes de añadir ${nombreCortoDe(app)}`)
      } else {
        setFijadas(fijar(app.id))
        setNota(`${nombreCortoDe(app)} añadida a la barra`)
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
    const estilo = { '--i': Math.min(i, 16), '--im-acento': colorDe.get(app.id) ?? 'var(--ls-acc)' } as CSSProperties
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
        <div className="min-w-0">
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
        </div>
        {apps.length > 0 && !consulta && (
          <button
            type="button"
            className="im-editar"
            data-activo={editando ? 'true' : undefined}
            aria-pressed={editando}
            aria-label={editando ? 'Terminar de editar la barra de abajo' : 'Editar la barra de abajo'}
            onClick={() => {
              setEditando(!editando)
              setNota('')
            }}
          >
            {editando ? <Check aria-hidden /> : <PenLine aria-hidden />}
            {editando ? 'Hecho' : 'Barra'}
          </button>
        )}
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
          {editando && (
            <section className="im-editor" aria-label="Tu barra de abajo">
              <div className="im-editor-titulo">Tu barra de abajo</div>
              {/* Cómo queda: Inicio y Más no se mueven; en medio, hasta 4 a tu gusto, en el orden que quieras */}
              <div className="im-editor-barra">
                <span className="im-editor-fijo">
                  <Home aria-hidden />
                  <span>Inicio</span>
                </span>
                {Array.from({ length: MAX_FIJADAS }, (_, n) => {
                  const app = apps.find((a) => a.id === fijadasIds[n])
                  if (!app) {
                    return (
                      <span key={`hueco-${n}`} className="im-editor-hueco">
                        <Plus aria-hidden />
                        <span>{solo ? 'Vacío' : 'Auto'}</span>
                      </span>
                    )
                  }
                  const Icono = app.icon
                  return (
                    <span key={app.id} className="im-editor-hueco" data-lleno="true" style={{ '--im-acento': colorDe.get(app.id) ?? 'var(--ls-acc)' } as CSSProperties}>
                      <button type="button" className="im-editor-quitar" onClick={() => (setFijadas(soltar(app.id)), setNota(`${nombreCortoDe(app)} ya no está en la barra`))} aria-label={`Quitar ${app.name} de la barra`}>
                        <X aria-hidden />
                      </button>
                      <Icono aria-hidden />
                      <span>{nombreCortoDe(app)}</span>
                      <span className="im-editor-mover">
                        <button type="button" disabled={n === 0} onClick={() => setFijadas(moverFijada(app.id, -1))} aria-label={`Mover ${app.name} a la izquierda`}>
                          <ChevronLeft aria-hidden />
                        </button>
                        <button type="button" disabled={n === fijadasIds.length - 1} onClick={() => setFijadas(moverFijada(app.id, 1))} aria-label={`Mover ${app.name} a la derecha`}>
                          <ChevronRight aria-hidden />
                        </button>
                      </span>
                    </span>
                  )
                })}
                <span className="im-editor-fijo">
                  <Menu aria-hidden />
                  <span>Más</span>
                </span>
              </div>
              <label className="im-editor-auto">
                <input type="checkbox" checked={!solo} onChange={() => (ponerSoloFijadas(!solo), setSolo(!solo))} />
                <span>Rellenar los huecos con las que más uso</span>
              </label>
              <p className="im-edicion-ayuda" role="status" aria-live="polite">
                {nota || 'Toca una aplicación de abajo para añadirla (o quitarla). Con las flechas cambias el orden.'}
              </p>
            </section>
          )}

          {/* Lo que te espera: correo, chat y leads sin ver, a un toque */}
          {!editando && pendientes.length > 0 && (
            <div className="im-pendientes" aria-label="Pendiente">
              {pendientes.map((p) => (
                <Link key={p.app.id} href={p.app.route} className="im-pendiente" onClick={() => avisarNavegando(p.app.route)} style={{ '--im-acento': colorDe.get(p.app.id) ?? 'var(--ls-acc)' } as CSSProperties} data-urgente={p.urgente ? 'true' : undefined}>
                  <p.icono aria-hidden />
                  <span>{p.texto}</span>
                  <b>{p.n > 99 ? '99+' : p.n}</b>
                </Link>
              ))}
            </div>
          )}

          {/* Recientes: una fila que se desliza, no otra rejilla de iconos grandes */}
          {recientes.length > 0 && !editando && (
            <section className="im-recientes" aria-labelledby="im-recientes">
              <h2 id="im-recientes" className="im-titulo-fijo">
                Recientes
              </h2>
              <div className="im-recientes-fila">
                {recientes.map((a) => {
                  const Icono = a.icon
                  return (
                    <Link key={a.id} href={a.route} className="im-reciente" onClick={() => avisarNavegando(a.route)} style={{ '--im-acento': colorDe.get(a.id) ?? 'var(--ls-acc)' } as CSSProperties}>
                      <Icono aria-hidden />
                      <span>{nombreCortoDe(a)}</span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {secciones.map((s, n) => {
            const plegada = plegadas.has(s.id)
            return (
              <section key={s.id} className="im-seccion im-tarjeta" style={{ '--n': n, '--im-acento': COLORES[n % COLORES.length] } as CSSProperties}>
                <h2>
                  <button type="button" className="im-titulo" aria-expanded={!plegada} aria-controls={`im-s-${s.id}`} onClick={() => alternar(s.id)}>
                    <span className="im-punto" aria-hidden />
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
