export interface NFTItem {
  token_id: string;
  title: string;
  owner_id: string;
  tickets: number;
}

export interface NFTQuery {
  id: string;
  searchTitle: string;
  nfts: NFTItem[];
}

export interface Prize {
  id: string;
  name: string;
  count: number;
}

export interface Winner {
  wallet: string;
  winningNumbers: number[];
  prizeCount: number;
}

export interface RaffleResult {
  id: string;
  timestamp: number;
  prizes: Prize[];
  winners: Winner[];
  totalTickets: number;
  csvData: Array<{ wallet: string; count: number }>;
}

export interface AppState {
  queries: NFTQuery[];
  prizes: Prize[];
  history: RaffleResult[];
}
