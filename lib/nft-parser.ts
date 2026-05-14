// Returns how many lottery tickets a single NFT with this title is worth.
//
// Only titles that explicitly start with "<N> ticket(s)..." carry an
// embedded ticket count; e.g. "12 tickets bee (epic)" → 12.
//
// Every other NFT — "Postage Stamp - York (rare)", "5th Eon of Earth",
// "Day Ticket Duplo (5 000 000 DarAi)" etc. — is worth exactly 1 ticket.
// Previously we grabbed the first digit anywhere in the title, which
// produced false positives ("5th Eon" → 5, "Duplo (1000 DarAi)" → 1000)
// and silently dropped NFTs with no digits at all.
export function extractTicketCount(title: string): number {
  const m = title.match(/^\s*(\d+)\s+tickets?\b/i);
  return m ? parseInt(m[1], 10) : 1;
}
