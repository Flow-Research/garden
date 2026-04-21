import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import agents from 'agents/vite'

const enableDevtools = process.env.ENABLE_DEVTOOLS === '1'

const config = defineConfig({
  clearScreen: false,
  resolve: { tsconfigPaths: true },
  plugins: [
    ...(enableDevtools ? [devtools()] : []),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    agents(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
