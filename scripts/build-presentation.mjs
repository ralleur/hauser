// SPDX-License-Identifier: AGPL-3.0-only
// Share /demo assets, but serve the embedded entry outside its PWA scope.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(resolve(root, 'app'));
process.env.VITE_DEMO = '1';
process.env.VITE_BACKEND = 'fake';
process.env.HAUSER_EXPERIENCE_PREVIEW = '1';
const { build } = await import('../app/node_modules/vite/dist/node/index.js');
await build({
  root: resolve(root, 'app'),
  base: '/demo/',
  publicDir: false,
  plugins: [{
    name: 'presentation-loading-milestone',
    transformIndexHtml(html) {
      return {
        html: html.replace(/((?:href|src)=")\/(?=(?:brand|icons|fonts)\/|manifest\.webmanifest)/g, '$1/demo/'),
        tags: [{ tag: 'script', injectTo: 'head-prepend', children: `if(new URLSearchParams(location.search).get('presentation')==='1'&&parent!==window)parent.postMessage({source:'hauser-demo',type:'loading',phase:1},location.origin);` }],
      };
    },
  }],
  build: { outDir: resolve(root, 'app/dist-pages-presentation'), emptyOutDir: true, copyPublicDir: false, sourcemap: false },
});
