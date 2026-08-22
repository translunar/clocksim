import type { AppState } from '../state';
import type { Store } from '../store';
import type { SimClient } from '../workerClient';
export interface ViewHandle { update(s: AppState): void; destroy(): void }
export type ViewFactory = (root: HTMLElement, store: Store, client: SimClient) => ViewHandle;
