'use client'

/**
 * LOS ICONOS QUE CRUZAN DE SERVIDOR A CLIENTE.
 *
 * `lucide-react` NO lleva la directiva `'use client'`. Sus iconos son
 * `forwardRef` con una función `render` dentro, así que en un componente de
 * servidor React los trata como referencias de servidor y NO PUEDE
 * SERIALIZARLOS cuando viajan como prop a un componente de cliente:
 *
 *     Error: Functions cannot be passed directly to Client Components
 *
 * Y ojo, porque esto no lo ve nadie hasta que se abre la página: `tsc` está
 * contento —el tipo es correcto— y `next build` también. Solo revienta al
 * renderizar, y entonces se lleva la pantalla entera por delante. Nos costó
 * Growth Partner completo.
 *
 * TAMPOCO BASTA con pasar el nodo ya construido (`icono={<Link2Off />}` en vez
 * de `icono={Link2Off}`): lo que se serializa es el elemento, y el `type` del
 * elemento sigue siendo la función. Ese fue el primer intento de arreglo y
 * fallaba igual.
 *
 * Reexportarlos desde un módulo con `'use client'` los convierte en
 * REFERENCIAS DE CLIENTE, que sí se serializan. Un fichero, y el problema no
 * vuelve.
 *
 * Cuándo hace falta: solo cuando un componente de SERVIDOR pasa un icono como
 * PROP a uno de CLIENTE. Dentro de un componente de cliente, o como hijo
 * normal, se puede seguir importando de `lucide-react` sin más.
 */

export {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  Crown,
  Database,
  Info,
  Link2Off,
  Package,
  Plug,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag,
  Users,
} from 'lucide-react'
