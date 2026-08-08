'use client'

/**
 * PANTALLA 1 — /dashboard, la rejilla de inicio.
 *
 * El problema medido: 18 objetos idénticos, 202 px de tarjeta cada uno para
 * tres líneas de texto, 18 iconos naranjas iguales, y la única información viva
 * de la pantalla —los leads web sin abrir— compitiendo de tú a tú con «Usos
 * horarios». En un portátil se ven 8 de 18.
 *
 * La respuesta de esta propuesta: partir la pantalla en dos alturas distintas.
 * Arriba, LO QUE PIDE ALGO HOY, que son cuatro números y es lo único que
 * cambia de un día para otro. Debajo, el LANZADOR, que es un directorio y debe
 * comportarse como un directorio: callado, agrupado por trabajo y entero a la
 * vista. El acento naranja aparece exactamente una vez, en la tarjeta que hay
 * que atender.
 */

import { ArrowRight, CalendarClock, Megaphone, PhoneCall, ShieldAlert } from 'lucide-react'
import { GRUPOS_APPS } from './datos'

interface Props {
  onNavegar: (id: string) => void
}

interface Aguja {
  id: string
  etiqueta: string
  valor: string
  pie: string
  icono: typeof PhoneCall
  urge?: boolean
}

/**
 * Cuatro, y no más. Si esta tira crece, vuelve a ser la rejilla de 18 con otro
 * aspecto. Solo entra aquí lo que se puede resolver hoy.
 */
const AGUJAS: Aguja[] = [
  { id: 'cold-calling', etiqueta: 'Rellamadas para hoy', valor: '23', pie: 'de 3.914 leads en cartera', icono: PhoneCall, urge: true },
  { id: 'web-leads', etiqueta: 'Leads web sin abrir', valor: '7', pie: 'el más antiguo, de hace 2 días', icono: ArrowRight, urge: true },
  { id: 'stock-sync', etiqueta: 'Envíos frenados', valor: '1', pie: 'Shoplamp · 34 % se iría a cero', icono: ShieldAlert },
  { id: 'agenda', etiqueta: 'Citas de esta semana', valor: '4', pie: 'la próxima, martes a las 16:00', icono: CalendarClock },
]

export function PantallaInicio({ onNavegar }: Props) {
  return (
    <main className="lsd-pantalla">
      {/* Título e identidad en una sola banda de 40 px. Hoy son 76-79 px de
          bloque de título más una tarjeta de bienvenida de 134 px al final,
          con el rol impreso en crudo («admin»). */}
      <div className="lsd-cabecera">
        <div className="lsd-cabecera-txt">
          <h1 className="lsd-titulo">Buenos días, Raúl</h1>
          <p className="lsd-cabecera-sub">Viernes 8 de agosto · 16 cuentas de Amazon activas</p>
        </div>
        <div className="lsd-cabecera-fin">
          <button type="button" className="lsd-btn" onClick={() => onNavegar('agenda')}>
            Ver la agenda del equipo
          </button>
        </div>
      </div>

      <div className="lsd-inicio">
        {/* ---------- Lo que pide algo hoy ---------- */}
        <section aria-label="Lo que pide algo hoy">
          <div className="lsd-hoy">
            {AGUJAS.map((a) => {
              const Icono = a.icono
              return (
                <button
                  key={a.id}
                  type="button"
                  className="lsd-hoy-t"
                  data-urge={a.urge ? 'si' : 'no'}
                  onClick={() => onNavegar(a.id)}
                >
                  <span className="lsd-hoy-ico lsd-sincolor" aria-hidden>
                    <Icono size={16} strokeWidth={2} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span className="lsd-cifra">{a.valor}</span>
                      <span className="lsd-etiqueta">{a.etiqueta}</span>
                    </span>
                    <span className="lsd-tenue" style={{ display: 'block' }}>{a.pie}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ---------- El lanzador ----------
            Agrupado por trabajo y en el orden en que se usa, no alfabético:
            un comercial lee cuatro nombres en vez de dieciocho. 38 px por
            módulo contra 202: los 18 caben sin scroll hasta en un portátil. */}
        <section className="lsd-secciones" aria-label="Aplicaciones">
          {GRUPOS_APPS.map((grupo) => (
            <div key={grupo.titulo}>
              <h2 className="lsd-seccion-tit">{grupo.titulo}</h2>
              <div className="lsd-apps">
                {grupo.apps.map((app) => {
                  const Icono = app.icono
                  return (
                    <button
                      key={app.id}
                      type="button"
                      className="lsd-app"
                      onClick={() => onNavegar(app.id)}
                      title={app.descripcion}
                    >
                      {/* El icono va en tinta, no en naranja. Los 18 iconos
                          naranjas idénticos de hoy son la prueba más clara de
                          que el acento había dejado de significar nada. */}
                      <Icono className="lsd-app-ico" size={16} strokeWidth={2} aria-hidden />
                      <span className="lsd-app-txt">
                        <span className="lsd-app-n">{app.nombre}</span>
                        <span className="lsd-app-d">{app.descripcion}</span>
                      </span>
                      {app.soloAdmin && <span className="lsd-app-solo">admin</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>

        <p className="lsd-tenue" style={{ maxWidth: 640 }}>
          <Megaphone size={12} style={{ verticalAlign: -2, marginRight: 5 }} aria-hidden />
          El lanzador es un directorio, así que se comporta como un directorio. Lo que cambia de un
          día para otro está arriba; esto de aquí se mira una vez y se aprende.
        </p>
      </div>
    </main>
  )
}
