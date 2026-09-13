import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// The wiki is published below the project website:
// https://ralleur.github.io/hauser/docs/
// Internal links in Markdown must therefore start with /hauser/docs/
// (Astro does not add the base path to links written in Markdown).
export default defineConfig({
  site: 'https://ralleur.github.io',
  base: '/hauser/docs',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Hauser Wiki',
      description: 'User and developer documentation for Hauser, the calm Home Assistant frontend for wall panels and phones.',
      logo: { src: './src/assets/hauser-icon.svg', alt: 'Hauser' },
      favicon: '/favicon.png',
      customCss: ['./src/styles/custom.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/ralleur/hauser' },
      ],
      editLink: { baseUrl: 'https://github.com/ralleur/hauser/edit/main/docs-site/' },
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Hauser website', link: 'https://ralleur.github.io/hauser/' },
        { label: 'Live demo', link: 'https://ralleur.github.io/hauser/demo/' },
        { label: 'Overview', items: [{ autogenerate: { directory: 'overview' } }] },
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'Using Hauser', items: [{ autogenerate: { directory: 'using' } }] },
        { label: 'Integrations', items: [{ autogenerate: { directory: 'integrations' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'Developers', items: [{ autogenerate: { directory: 'developers' } }] },
      ],
    }),
  ],
});
