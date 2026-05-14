import type { NearConnector as NearConnectorType } from '@hot-labs/near-connect';

let instance: NearConnectorType | null = null;

// Lazy singleton — the library touches window/localStorage at construction
// time, so it can only live on the client. Returns null during SSR.
export async function getConnector(): Promise<NearConnectorType | null> {
  if (typeof window === 'undefined') return null;
  if (instance) return instance;

  const { NearConnector } = await import('@hot-labs/near-connect');
  instance = new NearConnector({
    network: 'mainnet',
    autoConnect: true,
  });
  return instance;
}
