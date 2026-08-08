'use client'

import { useState } from 'react'

import { PantallaInicioHoy, PantallaColdCallingHoy, PantallaPerfilHoy } from './hoy'

import { useEstilosDenso } from '../denso/Marco'
import { PantallaInicio as InicioDenso } from '../denso/PantallaInicio'
import { PantallaColdCalling as ColdDenso } from '../denso/PantallaColdCalling'
import { PantallaPerfil as PerfilDenso } from '../denso/PantallaPerfil'

import { Marco as MarcoClaro } from '../claro/Marco'
import { PantallaInicio as InicioClaro } from '../claro/PantallaInicio'
import { PantallaColdCalling as ColdClaro } from '../claro/PantallaColdCalling'
import { PantallaPerfil as PerfilClaro } from '../claro/PantallaPerfil'

import { Armazon, type EstadoArmazon } from '../estructurado/Armazon'
import { PantallaInicio as InicioEstructurado } from '../estructurado/PantallaInicio'
import { PantallaColdCalling as ColdEstructurado } from '../estructurado/PantallaColdCalling'
import { PantallaPerfil as PerfilEstructurado } from '../estructurado/PantallaPerfil'
import { CUENTAS, type Cuenta } from '../estructurado/datos'
import type { EspacioId } from '../estructurado/navegacion'

import type { IdPantalla, IdPropuesta, Modo } from './propuestas'

/**
 * LAS CUATRO MAQUETAS DE UNA MISMA PANTALLA.
 *
 * Cada propuesta se monta con SU propio armazón —cada una lo diseñó, y el
 * armazón es parte de la propuesta—, pero el tema y la altura de la ventana los
 * manda el comparador. Esa es la única forma de que el salto de una a otra
 * cambie el diseño y nada más.
 *
 * Cada una vive bajo su clase raíz (`.hoy-raiz`, `.dz-raiz`, `.lsd-raiz`,
 * `.ctx-root`) y trae su propia hoja de estilos prefijada, así que las cuatro
 * pueden estar montadas a la vez sin pisarse. Está comprobado: es exactamente lo
 * que pasa aquí.
 *
 * NO se han tocado las tres carpetas de propuesta. Este fichero solo las importa.
 */

/* ------------------------------------------------------------------ */
/* Denso                                                               */
/* ------------------------------------------------------------------ */

function Denso({ pantalla, modo }: { pantalla: IdPantalla; modo: Modo }) {
  // La hoja de «denso» se inyecta en el <head> desde un efecto, igual que en su
  // propio conmutador. Es idempotente: comprueba el id antes de crear el <style>.
  useEstilosDenso()
  return (
    <div className="dz-raiz" data-dz-tema={modo === 'claro' ? 'claro' : 'oscuro'} style={{ height: '100%' }}>
      <div className="dz-marco" style={{ height: '100%', borderRadius: 0, border: 'none' }}>
        {pantalla === 'inicio' && <InicioDenso />}
        {pantalla === 'cold' && <ColdDenso />}
        {pantalla === 'perfil' && <PerfilDenso />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Claro                                                               */
/* ------------------------------------------------------------------ */

const MODULO_CLARO: Record<IdPantalla, string> = {
  inicio: 'home',
  cold: 'cold-calling',
  perfil: 'amazon-api',
}

function Claro({ pantalla, modo, sinColor }: { pantalla: IdPantalla; modo: Modo; sinColor: boolean }) {
  // El menú de esta propuesta navega de verdad; aquí se ignora, porque quien
  // manda qué pantalla se ve es el selector del comparador. Si no, al pulsar un
  // módulo cambiaría una maqueta y no las otras tres, y dejarían de ser
  // comparables.
  //
  // `sinColor` SÍ se pasa: es el interruptor que esta propuesta construyó para
  // demostrar el criterio 5 y antes se montaba en false fijo, o sea inalcanzable
  // desde la app donde se decide. El comparador además lo aplica por fuera a las
  // cuatro maquetas por igual; aplicarlo dos veces sobre esta no cambia el
  // resultado (gris de gris es el mismo gris) y mantiene la propuesta
  // comportándose como está diseñada.
  const navegar = () => {}
  return (
    <MarcoClaro modo={modo} sinColor={sinColor} activo={MODULO_CLARO[pantalla]} onNavegar={navegar}>
      {pantalla === 'inicio' && <InicioClaro onNavegar={navegar} />}
      {pantalla === 'cold' && <ColdClaro />}
      {pantalla === 'perfil' && <PerfilClaro />}
    </MarcoClaro>
  )
}

/* ------------------------------------------------------------------ */
/* Estructurado                                                        */
/* ------------------------------------------------------------------ */

/** Shoplamp: es la cuenta que tiene el perfil de stock con frenos apagados */
const CUENTA_INICIAL: Cuenta = CUENTAS[1]

const SITIO_ESTRUCTURADO: Record<IdPantalla, { espacio: EspacioId; modulo: string }> = {
  inicio: { espacio: 'mio', modulo: 'mi-dia' },
  cold: { espacio: 'agencia', modulo: 'cold-calling' },
  perfil: { espacio: 'clientes', modulo: 'perfiles' },
}

function Estructurado({ pantalla, modo, alto }: { pantalla: IdPantalla; modo: Modo; alto: number }) {
  // El alto de fila y el tinte de la tabla son ajustes que esta propuesta
  // defiende como preferencia del usuario: se quedan dentro, en su barra
  // superior, porque son parte de lo que hay que juzgar.
  const [densidad, setDensidad] = useState<EstadoArmazon['densidad']>('normal')
  const [tinte, setTinte] = useState(false)
  const [cuenta, setCuenta] = useState<Cuenta>(CUENTA_INICIAL)

  const sitio = SITIO_ESTRUCTURADO[pantalla]
  const estado: EstadoArmazon = {
    espacio: sitio.espacio,
    modulo: sitio.modulo,
    cuenta,
    tema: modo,
    densidad,
    tinteFila: tinte,
  }

  // El espacio y el módulo los manda el comparador; la cuenta, la densidad y el
  // tinte, la propia maqueta. Cambiar de cuenta sin salir de la pantalla es la
  // idea entera de esta propuesta, así que tiene que seguir funcionando aquí.
  const set = (p: Partial<EstadoArmazon>) => {
    if (p.cuenta) setCuenta(p.cuenta)
    if (p.densidad) setDensidad(p.densidad)
    if (p.tinteFila !== undefined) setTinte(p.tinteFila)
  }

  return (
    <Armazon estado={estado} set={set} alto={alto}>
      {pantalla === 'inicio' && (
        <InicioEstructurado onAbrirCuenta={(c) => setCuenta(c)} onIr={() => {}} />
      )}
      {pantalla === 'cold' && (
        <ColdEstructurado
          tema={modo}
          densidad={densidad}
          tinte={tinte}
          onTinte={setTinte}
          alto={alto}
        />
      )}
      {pantalla === 'perfil' && <PerfilEstructurado cuenta={cuenta} />}
    </Armazon>
  )
}

/* ------------------------------------------------------------------ */
/* Hoy                                                                 */
/* ------------------------------------------------------------------ */

function Hoy({ pantalla, modo }: { pantalla: IdPantalla; modo: Modo }) {
  const tema = modo === 'claro' ? 'claro' : 'oscuro'
  return (
    <>
      {pantalla === 'inicio' && <PantallaInicioHoy tema={tema} />}
      {pantalla === 'cold' && <PantallaColdCallingHoy tema={tema} />}
      {pantalla === 'perfil' && <PantallaPerfilHoy tema={tema} />}
    </>
  )
}

/* ------------------------------------------------------------------ */

export function Maqueta({
  propuesta,
  pantalla,
  modo,
  alto,
  sinColor,
}: {
  propuesta: IdPropuesta
  pantalla: IdPantalla
  modo: Modo
  alto: number
  /**
   * El comparador apaga el color de las CUATRO maquetas desde el envoltorio de la
   * ventana simulada, que es lo que garantiza que reciban el mismo tratamiento.
   * Aquí solo se reenvía a la propuesta clara, que trae su propio interruptor y
   * debe seguir comportándose como está diseñada.
   */
  sinColor: boolean
}) {
  switch (propuesta) {
    case 'hoy':
      return <Hoy pantalla={pantalla} modo={modo} />
    case 'denso':
      return <Denso pantalla={pantalla} modo={modo} />
    case 'claro':
      return <Claro pantalla={pantalla} modo={modo} sinColor={sinColor} />
    case 'estructurado':
      return <Estructurado pantalla={pantalla} modo={modo} alto={alto} />
  }
}
