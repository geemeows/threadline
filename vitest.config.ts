import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src/ui') } },
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/{server,cli,adapters,tracker,gating,pipeline,setup}/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: { '@': path.resolve(__dirname, './src/ui') } },
        test: {
          name: 'ui',
          environment: 'node',
          include: ['src/ui/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
