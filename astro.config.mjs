import { defineConfig } from 'astro/config';

export default defineConfig({
  // 自定义域名后续在 Vercel 控制台绑定；此处由环境变量注入，避免硬编码
  site: process.env.SITE_URL || 'https://toolbox.example.com',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
