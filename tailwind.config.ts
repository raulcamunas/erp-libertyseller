import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    /**
     * LIB TAMBIÉN, Y NO ES UN EXTRA.
     *
     * Tailwind solo genera las clases que ENCUENTRA ESCRITAS en los ficheros de
     * esta lista. Lo que no aparece aquí, no existe en el CSS — y no da ningún
     * error: el elemento se queda con lo que herede.
     *
     * En lib/ viven dos cosas que son puras cadenas de clases:
     *   · lib/estilo/denso.ts, el contrato de estilo de las pantallas nuevas.
     *   · los mapas de color de estado de lib/types/** (nueve).
     *
     * MEDIDO, no supuesto: sin esta línea, `text-[12.5px]` —el tamaño de texto
     * de trabajo de toda la estética nueva— no se emitía, y el explorador de
     * orígenes se pintaba a 16 px con el color heredado. Las clases que sí se
     * veían bien eran las que POR CASUALIDAD alguien había escrito también en
     * components/ (`text-[11px]`, `h-7`), que es la peor forma de que algo
     * funcione: parece que va, hasta que se usa un valor nuevo.
     *
     * Añadir ficheros a esta lista solo puede AÑADIR clases al CSS, nunca
     * quitarlas: no hay forma de que esto rompa una pantalla que hoy va bien.
     */
    './lib/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "rgba(255, 255, 255, 0.1)",
        input: "rgba(255, 255, 255, 0.1)",
        ring: "#FF6600",
        background: "#080808",
        foreground: "#FFFFFF",
        primary: "#FF6600",
        secondary: "#0073FF",
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "rgba(255, 255, 255, 0.03)",
          foreground: "#a0a0b0",
        },
        accent: {
          DEFAULT: "rgba(255, 102, 0, 0.1)",
          foreground: "#FF6600",
        },
        popover: {
          DEFAULT: "rgba(255, 255, 255, 0.02)",
          foreground: "#FFFFFF",
        },
        card: {
          DEFAULT: "rgba(255, 255, 255, 0.02)",
          foreground: "#FFFFFF",
        },
      },
      borderRadius: {
        lg: "24px",
        md: "12px",
        sm: "8px",
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-1px',
        wide: '1px',
        wider: '1.5px',
        widest: '2px',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'brand': '0 10px 20px rgba(255, 102, 0, 0.2)',
        'brand-lg': '0 15px 30px rgba(255, 102, 0, 0.3)',
        'glass': '0 20px 60px rgba(0, 0, 0, 0.3)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "text-blur-in": {
          "0%": {
            opacity: "0",
            filter: "blur(20px)",
            transform: "translateY(10px)",
          },
          "100%": {
            opacity: "1",
            filter: "blur(0)",
            transform: "translateY(0)",
          },
        },
        "mist-flow": {
          "0%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(-30px, 20px) scale(1.1)" },
          "66%": { transform: "translate(20px, -20px) scale(0.9)" },
          "100%": { transform: "translate(0, 0) scale(1)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "text-blur-in": "text-blur-in 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards",
        "mist-flow": "mist-flow 25s infinite alternate ease-in-out",
        "fade-in": "fade-in 0.8s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
