// Stable entry point for launchers and existing installations.
import {fileURLToPath} from 'node:url';
import {restoreLegacyComponents} from './tools/legacy-components.mjs';
restoreLegacyComponents();
export const {main,loadConfig,createRelay}=await import('./src/server/server.mjs');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
