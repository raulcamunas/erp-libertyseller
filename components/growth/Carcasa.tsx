'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CAMPO, PANTALLA, TEXTO, TIPO, TITULO, BOTON } from '@/lib/estilo/denso'
import { BotonInfo, ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { MODULOS, PARAM_CLIENTE, PARAM_MODULO, type ModuloId } from './modulos'

/**
 * LA CARCASA DE GROWTH PARTNER.
 *
 * UN SELECTOR DE CLIENTE ARRIBA, COMÚN A TODO EL MÓDULO, y debajo los
 * submódulos. Es literalmente lo que se pidió: «lo dividimos dentro de cada
 * módulo qué cliente manejamos». Se elige el cliente una vez y todos los
 * submódulos trabajan sobre él; cambiar de submódulo no lo olvida.
 *
 *
 * ============ POR QUÉ EL CLIENTE VA ARRIBA Y NO DENTRO DE CADA PANTALLA ============
 *
 * No es una preferencia de diseño: es el compromiso firmado ante Amazon. Los
 * datos de un vendedor se usan exclusivamente para operar y asesorar la cuenta de
 * ESE vendedor. Con el cliente arriba y en la URL, cualquier pantalla que cuelgue
 * de aquí nace filtrada por él y no hay forma de escribir por descuido una vista
 * que mezcle dos. Con un selector dentro de cada submódulo, la vista «todos los
 * clientes» aparece sola en cuanto alguien la echa de menos.
 *
 *
 * ============ POR QUÉ AQUÍ LA NAVEGACIÓN SÍ ES NAVEGACIÓN ============
 *
 * Al revés que las pestañas de Amazon API, aquí cambiar de submódulo es un
 * `<Link>` de verdad y el servidor rehace la página. Dos motivos:
 *
 *   1. Cada submódulo carga datos MUY distintos y pesados —el mapeo entero de un
 *      cliente, o su histórico de Buy Box—. Cargándolo todo por adelantado para
 *      poder cambiar sin ir al servidor, entrar a mirar el stock costaría también
 *      traerse la Buy Box.
 *   2. Aquí no hay nada en memoria que perder. Lo que se edita en el sincronismo
 *      se guarda contra la base al momento; no hay un montón de cambios sin
 *      enviar como en el catálogo, que es lo que obliga a interceptar el cambio
 *      de pestaña en el otro módulo.
 *
 * El CLIENTE, en cambio, va con `replace` y no con `push`: elegir cliente es
 * afinar la misma pantalla, no ir a otra. Con `push`, mirar tres clientes seguidos
 * y querer salir del módulo costaría tres pulsaciones del botón de atrás.
 */
export function Carcasa({
  clientes,
  cliente,
  modulo,
  modulos,
  info,
  children,
}: {
  clientes: ClienteGrowth[]
  /** El elegido. `null` solo cuando no hay ni un cliente dado de alta */
  cliente: ClienteGrowth | null
  modulo: ModuloId
  /**
   * Los submódulos que ESTA PERSONA puede ver, ya filtrados en el servidor.
   *
   * No es `MODULOS` a secas porque quien entra con el permiso suelto
   * 'stock-sync' —la persona de operaciones— ve UNO solo. Ver lib/growth/acceso.ts.
   *
   * VIAJAN SOLO LOS IDs, no los objetos `Modulo`. Cada `Modulo` lleva dentro su
   * `icono` de lucide, que es un forwardRef con una función `render`, y una
   * función NO cruza la frontera servidor→cliente: pasar la lista entera desde
   * la página —que es de servidor— reventaba con «Functions cannot be passed
   * directly to Client Components», exactamente el mismo fallo que tenía la
   * pantalla vacía. El id es una cadena; el icono se busca aquí, en cliente.
   */
  modulos: readonly ModuloId[]
  /** La explicación del submódulo abierto. La escribe su propio fichero */
  info: React.ReactNode
  children: React.ReactNode
}) {
  const router = useRouter()

  function irACliente(slug: string) {
    const url = new URLSearchParams()
    url.set(PARAM_MODULO, modulo)
    url.set(PARAM_CLIENTE, slug)
    router.replace(`/dashboard/growth?${url.toString()}`, { scroll: false })
  }

  function enlaceModulo(id: ModuloId) {
    const url = new URLSearchParams()
    url.set(PARAM_MODULO, id)
    // El cliente viaja con el enlace: es lo que hace que cambiar de submódulo no
    // olvide sobre quién estabas trabajando.
    if (cliente) url.set(PARAM_CLIENTE, cliente.slug)
    return `/dashboard/growth?${url.toString()}`
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* -------- Fila 1: el módulo, el cliente y la información -------- */}
      <div
        // El hueco de la derecha es para la barra FIJA del layout —el cambio de
        // tema y la campana de avisos—, que va en `fixed … right-16 lg:right-20
        // z-50` y flota POR ENCIMA de esta fila. Sin reservarlo, el contador de
        // «N sin enviar» quedaba literalmente debajo del icono de la campana:
        // justo el aviso que sí es accionable y el único que se deja en pantalla.
        // El layout no se toca, que lo comparten los treinta módulos.
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-[6px] min-w-0 lg:pr-36"
      >
        <h1 className={`${TITULO.pantalla} shrink-0`}>Growth Partner</h1>

        {cliente && (
          <label className="flex min-w-0 items-center gap-[6px]">
            <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0`}>Cliente</span>
            <select
              value={cliente.slug}
              onChange={(e) => irACliente(e.target.value)}
              className={`${CAMPO.input} max-w-[260px]`}
            >
              {clientes.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nombre}
                  {c.activo ? '' : ' — inactivo'}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ml-auto shrink-0">
          <BotonInfo titulo={`Growth Partner · ${nombreDe(modulo)}`}>
            <InfoModulo />
            {info}
          </BotonInfo>
        </div>
      </div>

      {/* -------- Fila 2: los submódulos -------- */}
      <nav
        className="flex shrink-0 flex-wrap items-center gap-[4px] min-w-0"
        aria-label="Submódulos de Growth Partner"
      >
        {MODULOS.filter((m) => modulos.includes(m.id)).map((m) => {
          const Icono = m.icono
          const activo = m.id === modulo
          // Lo que este cliente no tiene se sigue enseñando, apagado y dicho: un
          // botón que desaparece según el cliente hace que la barra baile y que
          // nadie sepa si el submódulo existe o si es que hoy no le toca.
          const disponible =
            !cliente ||
            (m.necesita === 'stock' ? cliente.stockClientId !== null : cliente.amazonClientId !== null)

          const dentro = (
            <>
              <Icono className="h-[13px] w-[13px] shrink-0" />
              {m.nombre}
            </>
          )

          // APAGADO DE VERDAD, NO SOLO DESTEÑIDO. Antes esto seguía siendo un
          // <Link> pulsable con opacity-50: un botón apagado que navega es un
          // botón encendido, y encima llevaba a la pantalla que explica que a
          // este cliente le falta ese lado. Lo que hace falta saber ya está en
          // el `title`, así que aquí no hay adónde ir.
          if (!disponible) {
            return (
              <span
                key={m.id}
                title={`${m.pista} · este cliente todavía no lo tiene`}
                aria-disabled="true"
                className={`${BOTON.chip} cursor-not-allowed opacity-50`}
              >
                {dentro}
              </span>
            )
          }

          return (
            <Link
              key={m.id}
              href={enlaceModulo(m.id)}
              aria-current={activo ? 'page' : undefined}
              title={m.pista}
              className={`${BOTON.chip} ${activo ? BOTON.chipEncendido : ''}`}
            >
              {dentro}
            </Link>
          )
        })}
      </nav>

      <div className="flex-1 min-h-0 min-w-0">{children}</div>
    </div>
  )
}

function nombreDe(id: ModuloId): string {
  return MODULOS.find((m) => m.id === id)?.nombre ?? 'Growth Partner'
}

/**
 * Lo que hay que saber del módulo entero, delante de la explicación de cada
 * submódulo. Se repite en los tres a propósito: el corte entre este módulo y
 * Amazon API es la pregunta que se hace todo el mundo la primera semana.
 */
function InfoModulo() {
  return (
    <SeccionInfo titulo="Qué es Growth Partner">
      <p>
        Es <strong>el trabajo</strong>: lo que hacemos para que la cuenta de un cliente crezca.
        Configurar con qué se trabaja es el otro módulo, <strong>Amazon API</strong>.
      </p>
      <p>
        La regla que decide dónde está cada pantalla: <strong>configurar allí, trabajar aquí</strong>
        . De dónde llega el fichero de un cliente se configura allí; sincronizarlo de verdad se hace
        aquí. Qué marcas son suyas se decide allí; el análisis FBM→FBA que usa esa marca se hace
        aquí.
      </p>
      <ListaInfo>
        <li>
          <strong>El cliente se elige una vez, arriba</strong>, y vale para todos los submódulos.
          Cambiar de submódulo no lo olvida.
        </li>
        <li>
          No hay ninguna pantalla que mezcle clientes. Los datos de un vendedor se usan
          exclusivamente para operar su cuenta: es un compromiso firmado con Amazon, no una
          preferencia.
        </li>
        <li>
          Un submódulo apagado significa que <em>este</em> cliente todavía no lo tiene —no manda
          volcado de stock, o no ha autorizado su cuenta—, no que esté roto.
        </li>
      </ListaInfo>
    </SeccionInfo>
  )
}
