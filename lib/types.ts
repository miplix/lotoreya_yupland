export interface NFTItem {
  token_id: string;
  title: string;
  owner_id: string;
  tickets: number;
  media?: string;
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
  availableAtDraw: number; // tickets available (total minus already used) at the time of this draw
  csvData: Array<{ wallet: string; count: number }>;
}

export interface AppState {
  queries: NFTQuery[];
  history: RaffleResult[];
  usedNumbers: number[]; // winning numbers from all previous raffles in this session
}

export interface DrawState {
  id: string;
  prizeLabel: string;
  totalTickets: number;
  winners: Winner[];
  timestamp: number;
  simultaneousCount: number;
}

export interface ServerState {
  history: RaffleResult[];
  latestDraw: DrawState | null;
}
