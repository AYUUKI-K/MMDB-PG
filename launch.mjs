// Stable entry point for launchers and existing installations.
import {fileURLToPath} from 'node:url';
import {main} from './src/server/launch.mjs';
export * from './src/server/launch.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
