// Returns how many lottery tickets a single NFT with this title is worth.
//
// Rule: if the title starts with a number followed by whitespace,
// that number is the ticket count. Examples:
//   "12 tickets bee (epic)"      → 12
//   "5 редких снежков"            →  5
//   "1 ticket hold (unique)"     →  1
//
// "5th Eon of Earth" → 1 (no whitespace after the digit — it's "5th",
// not "5 …").
//
// Anything else — "Postage Stamp - York (rare)", "Day Ticket Duplo
// (5 000 000 DarAi)", "Ticket Duplo (1000 DarAi)" — is worth 1 ticket.
export function extractTicketCount(title: string): number {
  const m = title.match(/^\s*(\d+)\s+/);
  return m ? parseInt(m[1], 10) : 1;
}
