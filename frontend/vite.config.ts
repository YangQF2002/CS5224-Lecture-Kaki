import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Lecture JSON is same-origin in production; see docs/lecture-data.md.
      '/lectures': {
        target: process.env.LECTURES_ORIGIN ?? 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
})
