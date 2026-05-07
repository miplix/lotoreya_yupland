// Resolves an NFT media field to a loadable URL.
// Sendler returns three shapes:
//   1. https://gateway.../ipfs/Qm... — already a full URL
//   2. ipfs://Qm... — IPFS protocol, needs a gateway
//   3. Qm... / bafy... — bare CID, needs a gateway
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

export function resolveImage(media: string | null | undefined): string {
  if (!media) return '';
  const s = media.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('ipfs://')) {
    return IPFS_GATEWAY + s.slice('ipfs://'.length).replace(/^\/+/, '');
  }
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|ba[fk-z][a-z0-9]+)$/i.test(s)) {
    return IPFS_GATEWAY + s;
  }
  return s;
}
