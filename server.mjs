// Stable entry point for launchers and existing installations.
import {fileURLToPath} from 'node:url';
import {main} from './src/server/server.mjs';
export * from './src/server/server.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
