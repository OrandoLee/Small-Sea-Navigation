import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  // 本地开发使用根路径：
  // http://127.0.0.1:5173/
  // 生产构建发布到 GitHub Pages 子路径：
  // https://orandolee.github.io/Small-Sea-Navigation/
  // 如果部署到根域名、Vercel 或 Netlify，请把 build base 改为 '/'。
  base: command === 'serve' ? '/' : '/Small-Sea-Navigation/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
}))

