'use client'

import { PERMISOS_SUELTOS, apps } from '@/lib/config/apps'
import { OPCIONES_DE_ROL, PERMISOS_DEL_PUESTO, esPuesto, llevaListaPropia, rolYPuestoDe, type OpcionDeRol } from '@/lib/usuarios/puestos'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

/**
 * EL DESPLEGABLE «ROL» DE GESTIÓN DE USUARIOS, CON LOS TRES PUESTOS DEL EQUIPO.
 *
 * Ofrece los roles de siempre (Empleado, Admin, Partner, Cliente) y, además, Comercial, Manager Comercial y Gestión Administrativa. Esos tres NO son roles nuevos: al guardar se
 * convierten en rol «empleado» + puesto (lib/usuarios/puestos.ts), y al elegirlos el formulario pre-marca las casillas de ese puesto. Debajo del desplegable se dice qué significa
 * lo elegido y qué casillas se han marcado, para que no haya sorpresas.
 *
 * Los dos formularios (crear y editar) lo usan igual; solo al crear se ofrece crear la lista de leads de quien llama.
 */

const NOMBRE_DE_CASILLA = new Map<string, string>([...apps.map((a) => [a.id, a.name] as const), ...PERMISOS_SUELTOS.map((p) => [p.id, p.name] as const)])

interface Props {
  /** El `id` del <select>, para que su etiqueta lo apunte */
  idBase: string
  opcion: OpcionDeRol
  onCambiar: (opcion: OpcionDeRol) => void
  /** Si la persona llama (sale en el equipo de Cold Calling y en la Agenda). Solo se pregunta a un Manager Comercial */
  llama: boolean
  onLlama: (llama: boolean) => void
  /** Solo al crear: si se le crea su lista de leads. undefined = no se ofrece (al editar) */
  crearLista?: boolean
  onCrearLista?: (crear: boolean) => void
}

export function SelectorDeRol({ idBase, opcion, onCambiar, llama, onLlama, crearLista, onCrearLista }: Props) {
  const actual = OPCIONES_DE_ROL.find((o) => o.valor === opcion) ?? OPCIONES_DE_ROL[0]
  const { puesto } = rolYPuestoDe(opcion)
  const casillas = puesto ? PERMISOS_DEL_PUESTO[puesto].map((id) => NOMBRE_DE_CASILLA.get(id) ?? id) : []
  const ofreceLista = crearLista !== undefined && onCrearLista !== undefined && llevaListaPropia(puesto, puesto === 'comercial' ? true : llama)
  const grupo = (g: 'empleado' | 'puesto' | 'direccion' | 'externo') => OPCIONES_DE_ROL.filter((o) => o.grupo === g)

  return (
    <div>
      <Label htmlFor={idBase} className="text-sm font-semibold text-white mb-2 block">
        Rol
      </Label>
      <select
        id={idBase}
        value={opcion}
        onChange={(e) => onCambiar(e.target.value as OpcionDeRol)}
        className="w-full h-10 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:ring-offset-2 focus:border-[#FF6600]"
      >
        {grupo('empleado').map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
        <optgroup label="Puestos del equipo">
          {grupo('puesto').map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </optgroup>
        <optgroup label="Dirección">
          {grupo('direccion').map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </optgroup>
        {grupo('externo').map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>

      <p className="mt-2 text-xs text-white/60">{actual.ayuda}</p>
      {esPuesto(opcion) && casillas.length > 0 && (
        <p className="mt-1 text-xs text-white/45">
          Casillas que se marcan al elegirlo: {casillas.join(', ')}. Se pueden cambiar abajo antes de guardar.
        </p>
      )}

      {opcion === 'manager_comercial' && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-white">
          <Checkbox
            checked={llama}
            onCheckedChange={(v) => onLlama(v === true)}
            className="mt-0.5 border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600]"
          />
          <span>
            También llama y atiende citas
            <span className="block text-xs text-white/50">Sale en el equipo de Cold Calling y en la Agenda, y se le pueden asignar leads.</span>
          </span>
        </label>
      )}

      {ofreceLista && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-white">
          <Checkbox
            checked={crearLista === true}
            onCheckedChange={(v) => onCrearLista?.(v === true)}
            className="mt-0.5 border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600]"
          />
          <span>
            Crearle su lista de leads
            <span className="block text-xs text-white/50">Se crea una lista con su nombre, asignada a esta persona, para ir repartiéndole leads desde Cold Calling → Listas.</span>
          </span>
        </label>
      )}
    </div>
  )
}
