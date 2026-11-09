import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'app-version',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/version.json') return next();
        try {
          // Read on each request so local version edits appear without restarting Vite.
          const model = await readFile(new URL('./src/model.ts', import.meta.url), 'utf8');
          const version = model.match(/export const GAME_VERSION = '([^']+)'/)[1];
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ version }));
        } catch (error) { next(error); }
      });
    },
  }],
  build: {
    outDir: 'public_html',
  },
});
