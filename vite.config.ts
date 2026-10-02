import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'wayward-local-images',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            
            // Serve local images folder and image connection scripts directly if requested
            if (url.startsWith('/images/') || (url.startsWith('/images-') && url.split('?')[0].endsWith('.js'))) {
              // Clean query parameters
              const cleanUrl = url.split('?')[0];
              const localPath = path.join(process.cwd(), cleanUrl);
              
              if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
                const ext = path.extname(localPath).toLowerCase();
                const mimeTypes: Record<string, string> = {
                  '.png': 'image/png',
                  '.jpg': 'image/jpeg',
                  '.jpeg': 'image/jpeg',
                  '.webp': 'image/webp',
                  '.gif': 'image/gif',
                  '.svg': 'image/svg+xml',
                  '.js': 'application/javascript; charset=utf-8'
                };
                
                res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
                fs.createReadStream(localPath).pipe(res);
                return;
              }
            }
            next();
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
