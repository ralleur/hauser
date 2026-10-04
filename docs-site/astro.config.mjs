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
      title: 'Hauser guide',
      description: 'Set up Hauser with Apple Home or Home Assistant. Guides for rooms, everyday controls, installation and development.',
      logo: {
        light: '../app/public/brand/hauser-logo-light.svg',
        dark: '../app/public/brand/hauser-logo-dark.svg',
        alt: 'Hauser',
        replacesTitle: true,
      },
      favicon: '/favicon.png',
      customCss: ['./src/styles/custom.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/ralleur/hauser' },
      ],
      editLink: { baseUrl: 'https://github.com/ralleur/hauser/edit/main/docs-site/' },
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Guide home', link: '/hauser/docs/' },
        { label: 'Getting started', items: [
          { slug: 'getting-started/requirements' },
          { slug: 'integrations/companion-app', label: 'iPhone & iPad app' },
          { slug: 'getting-started/home-assistant-app' },
          { slug: 'getting-started/docker-compose' },
          { slug: 'getting-started/first-setup' },
          { slug: 'getting-started/phones-and-panels' },
          { slug: 'getting-started/updates-and-backups' },
        ] },
        { label: 'About Hauser', collapsed: true, items: [{ autogenerate: { directory: 'overview' } }] },
        { label: 'Everyday use', collapsed: true, items: [{ autogenerate: { directory: 'using' } }] },
        { label: 'Connected services', collapsed: true, items: [
          { slug: 'integrations/home-assistant' },
          { slug: 'integrations/jellyfin' },
          { slug: 'integrations/openai' },
          { slug: 'integrations/paperless' },
          { slug: 'integrations/notion' },
          { slug: 'integrations/openstreetmap' },
          { slug: 'integrations/open-meteo' },
          { slug: 'integrations/remote-access' },
        ] },
        { label: 'Reference & help', collapsed: true, items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'For developers', collapsed: true, items: [{ autogenerate: { directory: 'developers' } }] },
        { label: 'Hauser website ↗', link: 'https://ralleur.github.io/hauser/' },
        { label: 'Live demo ↗', link: 'https://ralleur.github.io/hauser/demo/' },
      ],
    }),
  ],
});
