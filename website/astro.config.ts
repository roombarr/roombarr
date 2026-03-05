import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://roombarr.github.io',
  base: '/roombarr/',
  integrations: [
    starlight({
      title: 'Roombarr',
      logo: {
        src: './src/assets/logo-transparent.png',
      },
      favicon: '/favicon.png',
      customCss: ['./src/styles/custom.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/roombarr/roombarr',
        },
      ],
    }),
  ],
});
