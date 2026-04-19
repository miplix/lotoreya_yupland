// Extracts the first number from an NFT title as the ticket count
// e.g. "12 tickets bee (epic)" → 12
export function extractTicketCount(title: string): number {
  const match = title.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}
