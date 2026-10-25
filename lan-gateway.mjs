// Stable entry point for launchers and existing installations.
import {fileURLToPath} from 'node:url';
import {main} from './src/server/lan-gateway.mjs';
export * from './src/server/lan-gateway.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
