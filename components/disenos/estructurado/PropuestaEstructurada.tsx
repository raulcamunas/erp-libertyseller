'use client'

import React, { useState } from 'react'
import { Armazon, type EstadoArmazon } from './Armazon'
import { PantallaInicio } from './PantallaInicio'
import { PantallaColdCalling } from './PantallaColdCalling'
import { PantallaPerfil } from './PantallaPerfil'
import { CUENTAS } from './datos'
import { MODULOS, type EspacioId } from './navegacion'
import { Caja } from './piezas'
import { VENTANAS } from './metricas'

/**
 * PROPUESTA «ESTRUCTURADA POR CONTEXTO» — el punto de entrada.
 *
 * Se monta sola: <PropuestaEstructurada /> y ya. No necesita provider, ni ruta, ni
 * tocar globals.css. Todo su CSS va dentro de un `.ctx-root` con `data-ctx-tema`, así
 * que convive con el ERP tal cual está y con las otras dos propuestas.
 *
 * LA IDEA EN UNA FRASE
 * El cliente deja de ser un filtro dentro de cada módulo y pasa a ser el contexto del
 * ERP: se elige una cuenta arriba, se queda a la vista, y las herramientas se
 * reorganizan alrededor — con «lo mío» y «la agencia» en un espacio aparte que nunca
 * se mezcla con el trabajo de cliente.
 *
 * Tres pantallas maquetadas de verdad, con contenido real:
 *   · Mi trabajo → Mi día              (la portada)
 *   · Agencia    → Cold Calling        (la tabla larga)
 *   · Clientes   → Perfiles de lectura (el formulario denso)
 */

const PANTALLAS_HECHAS = new Set(['mio/mi-dia', 'agencia/cold-calling', 'clientes/perfiles'])

export default function PropuestaEstructurada() {
  const [alto, setAlto] = useState(1080)
  const [estado, setEstado] = useState<EstadoArmazon>({
    espacio: 'mio',
    modulo: 'mi-dia',
    cuenta: CUENTAS[1], // Shoplamp: es la que tiene el perfil de stock con frenos apagados
    tema: 'claro',
    densidad: 'normal',
    tinteFila: false,
  })

  const set = (p: Partial<EstadoArmazon>) => setEstado((e) => ({ ...e, ...p }))
  const clave = `${estado.espacio}/${estado.modulo}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Mandos de la maqueta. Van FUERA del `.ctx-root` a propósito: no son parte de
          la propuesta, son para poder juzgarla. Estilos en línea y neutros para que
          la capa de tema claro del ERP no los reinterprete. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ opacity: 0.7 }}>Alto de la ventana:</span>
        {VENTANAS.map((v) => (
          <button
            key={v.alto}
            type="button"
            onClick={() => setAlto(v.alto)}
            title={v.que}
            style={{
              height: 26,
              padding: '0 10px',
              borderRadius: 6,
              border: '1px solid rgba(128,128,128,0.45)',
              background: alto === v.alto ? 'rgba(255,102,0,0.16)' : 'transparent',
              color: 'inherit',
              fontWeight: alto === v.alto ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {v.alto} px
          </button>
        ))}
        <span style={{ opacity: 0.55 }}>
          · El tema, la densidad y el tinte de fila se cambian dentro, en la barra superior.
        </span>
      </div>

      <Armazon estado={estado} set={set} alto={alto}>
        {clave === 'mio/mi-dia' && (
          <PantallaInicio
            onAbrirCuenta={(c) => set({ cuenta: c, espacio: 'clientes', modulo: 'resumen' })}
            onIr={(espacio: EspacioId, modulo: string) => set({ espacio, modulo })}
          />
        )}

        {clave === 'agencia/cold-calling' && (
          <PantallaColdCalling
            tema={estado.tema}
            densidad={estado.densidad}
            tinte={estado.tinteFila}
            onTinte={(v) => set({ tinteFila: v })}
            alto={alto}
          />
        )}

        {clave === 'clientes/perfiles' && <PantallaPerfil cuenta={estado.cuenta} />}

        {!PANTALLAS_HECHAS.has(clave) && <NoMaquetada espacio={estado.espacio} modulo={estado.modulo} />}
      </Armazon>
    </div>
  )
}

function NoMaquetada({ espacio, modulo }: { espacio: EspacioId; modulo: string }) {
  const m = MODULOS[espacio].find((x) => x.id === modulo)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
      <div>
        <div className="ctx-xl">{m?.nombre ?? modulo}</div>
        <div className="ctx-sm" style={{ marginTop: 4 }}>
          Ruta actual del ERP: <code className="ctx-num">{m?.ruta}</code>
        </div>
      </div>
      <Caja tipo="info">
        Esta propuesta maqueta a fondo <strong>tres pantallas</strong> —Mi día, Cold Calling y los
        perfiles de lectura— porque son las que el diagnóstico señala y las que permiten comparar
        las tres propuestas entre sí. El resto de módulos siguen exactamente donde están: lo único
        que cambia aquí es <strong>de qué cuelgan</strong> y <strong>si hay una cuenta detrás</strong>.
        Pincha en el carril de la izquierda para ver cómo se reordenan.
      </Caja>
      <Caja tipo="ok">
        Fíjate en el selector de arriba a la izquierda: en <strong>Mi trabajo</strong> y en{' '}
        <strong>Agencia</strong> se apaga y dice «Sin cuenta · Herramientas internas». En{' '}
        <strong>Mis clientes</strong> se enciende con el nombre y el mercado. Es la diferencia entre
        las dos naturalezas del ERP, dicha en 300 px de barra.
      </Caja>
    </div>
  )
}
