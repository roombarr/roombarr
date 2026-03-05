import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://roombarr.github.io',
  base: '/roombarr/',
  integrations: [
    starlight({
      title: 'Roombarr',
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
