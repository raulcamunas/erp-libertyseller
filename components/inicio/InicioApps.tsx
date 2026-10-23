import type { CSSProperties } from 'react'
import { ArrowUpRight, LayoutGrid, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AppConfig } from '@/lib/config/apps'
import { etiquetaDeRol } from '@/lib/inicio/saludo'
import { Saludo } from './Saludo'
import { TarjetaDeApp } from './TarjetaDeApp'

/**
 * LA PANTALLA DE INICIO: una cabecera con el saludo y la lista de aplicaciones de quien ha entrado.
 *
 * Solo pinta. Qué aplicaciones ve cada persona (rol, permisos sueltos, las que se ocultan al admin…) lo decide app/dashboard/page.tsx, que es quien
 * tiene los datos; aquí llega la lista ya filtrada. El estilo y el movimiento viven en el bloque «Inicio y acceso» de app/globals.css (`inicio-*`).
 */
export function InicioApps({ nombre, rol, apps }: { nombre: string; rol: string; apps: AppConfig[] }) {
  const paso = (n: number) => ({ '--d': n }) as CSSProperties
  const enOrbita = apps.slice(0, 5)

  return (
    <div className="max-w-7xl mx-auto">
      <section className="inicio-hero inicio-hero-entra">
        <div className="inicio-hero-rejilla" aria-hidden />
        {/* La órbita: hasta cinco de sus aplicaciones dando vueltas muy despacio alrededor del punto naranja. Es adorno (aria-hidden) y se esconde en pantallas estrechas */}
        <div className="inicio-orbita inicio-entra" style={paso(3)} aria-hidden>
          <div className="inicio-orbita-giro">
            <span className="inicio-orbita-anillo" />
            <span className="inicio-orbita-anillo inicio-orbita-anillo-2" />
            {enOrbita.map((app, i) => {
              const Icono = app.icon
              const angulo = (i / enOrbita.length) * 2 * Math.PI - Math.PI / 2
              return (
                <span key={app.id} className="inicio-orbita-pos" style={{ left: `${(50 + 40 * Math.cos(angulo)).toFixed(2)}%`, top: `${(50 + 40 * Math.sin(angulo)).toFixed(2)}%` }}>
                  <span className="inicio-orbita-chip">
                    <Icono className="h-[18px] w-[18px]" />
                  </span>
                </span>
              )
            })}
          </div>
          <span className="inicio-orbita-centro">
            <Sparkles className="h-5 w-5" />
          </span>
        </div>

        <div className="relative z-10 min-w-0 max-w-[38rem]">
          <span className="inicio-etiqueta inicio-entra" style={paso(0)}>
            Liberty Seller Hub
          </span>
          <Saludo nombre={nombre} cantidad={apps.length}>
            <span className="inicio-rol">
              <span className="inicio-punto" aria-hidden />
              Sesión activa · {etiquetaDeRol(rol)}
            </span>
          </Saludo>
        </div>
      </section>

      <div className="inicio-seccion inicio-aparece" style={paso(2)}>
        <h2>Tus aplicaciones</h2>
        <span>{apps.length}</span>
      </div>

      {apps.length === 0 ? (
        <div className="inicio-vacio inicio-aparece" style={paso(3)}>
          <LayoutGrid className="h-6 w-6" aria-hidden />
          <p>Todavía no tienes aplicaciones asignadas. Pídele a quien te dio la cuenta que te dé acceso.</p>
        </div>
      ) : (
        <div className="inicio-rejilla">
          {apps.map((app, i) => {
            const Icono = app.icon
            return (
              <TarjetaDeApp key={app.id} href={app.route} indice={i + 3}>
                <div className="inicio-icono">
                  <Icono className="h-6 w-6" />
                </div>
                <h3 className="inicio-app-nombre">{app.name}</h3>
                <p className="inicio-app-desc">{app.description}</p>
                <div className="inicio-pie">
                  <div className="flex min-w-0 items-center gap-2">
                    {app.badge && (
                      <Badge variant="nuevo" className="text-xs">
                        {app.badge}
                      </Badge>
                    )}
                    {app.status === 'inactive' && <span className="text-xs text-white/30">Próximamente</span>}
                  </div>
                  <ArrowUpRight className="inicio-flecha h-[18px] w-[18px]" aria-hidden />
                </div>
              </TarjetaDeApp>
            )
          })}
        </div>
      )}
    </div>
  )
}
