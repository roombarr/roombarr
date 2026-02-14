import type { Configuration } from 'lint-staged';

const config: Configuration = {
  '*': 'biome check --write --files-ignore-unknown=true --no-errors-on-unmatched',
};

export default config;
