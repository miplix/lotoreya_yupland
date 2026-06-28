# lotoreya_yupland — заметки для разработки

Лотерея NFT/токенов для оператора (darai_collection.near). Next.js 15, `basePath: /lotoreya`,
деплой на Vercel (`miplix/lotoreya_yupland`, team ms-projects-d7c951bf), проксится как
`service.yupland.io/lotoreya`. Деплой = `git push origin main` → авто-сборка Vercel.

## Архитектура / важные факты (правил не нарушать)

- **БД = Supabase, схема `yuplink`** (`lib/turso.ts`, интерфейс `execute({sql,args})` поверх
  supabase-js; env `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY`). Это
  **ОТДЕЛЬНАЯ** база от портального Postgres `mcp.yupland.io` (golden-drop) — не путать.
- **Операторская `/lotoreya` гейтится `ACCESS_KEY`** (middleware → 307 на `/lotoreya/watch`,
  если cookie не совпал). Без ключа открыть нельзя.

## NFT-пикер (NFTSection / PrizeSection / SuggestionDropdown)

- Источник 1 — кэш `collection_titles` (`/api/nft-titles`, ~1900 title+image+count), фильтр
  клиентский, на фокусе показывается топ-список.
- Источник 2 (фоллбэк) — живой поиск `/api/search-nft` (Sendler), когда в кэше нет совпадений.
- Кэш НЕПОЛНЫЙ: пополняется сканом, новые NFT появляются только после скана.

## Скан `/api/nft-scan`

- Пагинирует Sendler (`api.sendler.xyz`, env `NFT_API_KEY`) с `last_skip`, пишет в
  `collection_titles`.
- **Констрейнт `collection_titles_unique` case-insensitive** (по `(contract_id, lower(title))`).
  Upsert в `lib/turso.ts` обязан дедупить батч по `lower(title)` и матчить существующие по lower —
  иначе `duplicate key` валит ВЕСЬ батч и свежие NFT не доходят.
- Кнопка «Сканировать» в UI ловит ошибку — POST должен возвращать `{error}`, не голый 500.

## Подпись выплат (YupLink кошелёк) — `lib/yuplink-wallet.ts`

- Окно подписи = `service.yupland.io/wallet/sign` (golden-drop, MNW-совместимый). Это **ТОТ ЖЕ
  origin**, что и лотерея → iframe same-origin видит то же хранилище кошелька. Открывается
  **iframe-оверлеем** в лотерее (без перехода), `signerId=darai_collection.near`.
- ⚠️ `yupland.io` — ДРУГОЕ приложение (платформа Yupland), у него НЕТ `/wallet/sign` (404). Туда
  направлять нельзя.
- `callbackUrl` обязан включать basePath: `${origin}/lotoreya/wallet-callback`. Callback шлёт
  `postMessage({type:"yuplink-sign-result",...})` в `window.parent`.

## Выплаты (PayoutPanel + lib/payout.ts)

- NFT: все пары `[token_id, кошелёк]` → `nft_batch_transfer`, чанк по **≤8 пар** на вызов,
  `splitTxs` раскладывает по tx ≤280 TGas.
- Токены: `storage_deposit` + `ft_transfer` на победителя (см. TODO ниже).
- После успеха окно показывает «✓ Выдано» и авто-закрывается; кнопка при done заблокирована.

## TODO / known issues

- FT-выплата делает `storage_deposit` всегда, без проверки `storage_balance_of` — лишний расход.
- Детали `ft_transfer`/`storage_deposit` на подписи показываются свёрнутым JSON (улучшено только
  для nft_transfer/nft_batch_transfer).
