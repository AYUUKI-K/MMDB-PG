// Resolve against the installation, never the caller's working directory.
// User configuration stays at the app root so existing managers can preserve it.
export const appRoot = new URL('../../', import.meta.url);
export const assetRoot = new URL('dist/', appRoot);
