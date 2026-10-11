import type { CodApi } from '../shared/ipc.ts';

declare global {
  interface Window {
    // Exposed by the preload script (src/preload.ts).
    cod: CodApi;
  }
}
