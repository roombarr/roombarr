import type { Configuration } from 'lint-staged';

const config: Configuration = {
  '*.{md,mdx,yaml,yml,astro,css}': 'prettier --write',
  '*': 'biome check --write --files-ignore-unknown=true --no-errors-on-unmatched',
};

export default config;
