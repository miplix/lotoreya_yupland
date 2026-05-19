import { NextRequest, NextResponse } from 'next/server';

// Возвращает NFT, которые owner реально держит с заданным title.
//
// КРИТИЧНО: Sendler endpoint `/nft/?title=...&owner_id=...` ИГНОРИРУЕТ
// owner_id когда задан title — отдаёт ВСЕХ владельцев с этим title.
// Это приводило к 404 на минте и попыткам transfer чужих токенов.
//
// Правильный паттерн (как в sendler-alchemy-balances/lib/sendler.js):
//   1. /nft/by-owner-contract/?owner_id=...&contract_address=... — все
//      NFT этого owner'а в коллекции (с пагинацией)
//   2. фильтруем в JS по title (case-insensitive exact match)
//   3. /nft/?contract_address=...&title=...&limit=1 — образец для
//      метаданных (если у нас нет ни одного экземпляра)

const SENDLER_BASE = 'https://api.sendler.xyz';
const MINTBASE_CONTRACT = 'yuplandshop.mintbase1.near';
const PAGE_SIZE = 200;
const MAX_PAGES = 50; // 10 000 NFT — больше чем содержит darai_collection

interface SendlerItem {
  token_id: string;
  title?: string;
  owner_id?: string;
  media?: string;
  description?: string;
  reputation?: number;
  nft_contract_id?: string;
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'X-API-Key': apiKey, accept: 'application/json' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Sendler HTTP ${res.status}: ${url.slice(0, 120)}`);
  return res.json();
}

// Постранично достаём всё что owner держит в контракте.
async function fetchAllByOwnerContract(
  apiKey: string,
  ownerId: string,
  contract: string,
): Promise<SendlerItem[]> {
  const out: SendlerItem[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({
      owner_id: ownerId,
      contract_address: contract,
      skip: String(i * PAGE_SIZE),
      limit: String(PAGE_SIZE),
    });
    const data = (await fetchJson(
      `${SENDLER_BASE}/nft/by-owner-contract/?${qs}`,
      apiKey,
    )) as { items?: SendlerItem[] } | SendlerItem[];
    const items = Array.isArray(data) ? data : data.items ?? [];
    if (items.length === 0) break;
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

// Один экземпляр по title — для шаблона метаданных при минте.
async function fetchTemplateByTitle(
  apiKey: string,
  contract: string,
  title: string,
): Promise<SendlerItem | null> {
  const qs = new URLSearchParams({
    contract_address: contract,
    title,
    limit: '1',
  });
  const data = (await fetchJson(
    `${SENDLER_BASE}/nft/?${qs}`,
    apiKey,
  )) as { items?: SendlerItem[] };
  const items = data.items ?? [];
  return items[0] ?? null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const owner = params.get('owner');
  const title = params.get('title');
  const contractParam = params.get('contract') ?? '';
  if (!owner || !title) {
    return NextResponse.json({ error: 'owner & title required' }, { status: 400 });
  }
  const apiKey = process.env.NFT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'NFT_API_KEY missing' }, { status: 500 });
  }

  try {
    // Если контракт не задан — пробуем найти title в нашей основной коллекции.
    const contract = contractParam || MINTBASE_CONTRACT;
    const targetLower = title.toLowerCase();

    // 1. Все NFT owner'а в этом контракте (надёжно — owner_id уважается).
    const ownerNfts = await fetchAllByOwnerContract(apiKey, owner, contract);
    const matched = ownerNfts.filter(
      (i) => (i.title ?? '').toLowerCase() === targetLower,
    );

    // 2. Шаблон метаданных. Если у нас уже есть совпадение — берём оттуда,
    //    иначе ищем любой экземпляр в коллекции (нужно для минта).
    let template: SendlerItem | null = matched[0] ?? null;
    if (!template) {
      template = await fetchTemplateByTitle(apiKey, contract, title);
    }

    // 3. Резолвим контракт: если совпадение найдено — берём контракт из items
    //    (на случай если title живёт в другом контракте). Иначе оставляем
    //    запрошенный (или дефолтный mintbase).
    const detectedContract =
      matched[0]?.nft_contract_id ?? template?.nft_contract_id ?? contract;

    return NextResponse.json({
      contract: detectedContract,
      // Минтить можем только в наш собственный коллекшен на Mintbase.
      mintable: detectedContract === MINTBASE_CONTRACT,
      title,
      owner,
      // Только tokenId'ы, реально принадлежащие owner'у — никаких чужих.
      tokenIds: matched.map((i) => String(i.token_id)),
      template: template
        ? {
            title: template.title ?? title,
            description: template.description ?? '',
            media: template.media ?? '',
            reputation: Number(template.reputation ?? 0),
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown' },
      { status: 500 },
    );
  }
}
