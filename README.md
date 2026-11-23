# SmartDoc Horní Moštěnice

Chytré hledání v obecních dokumentech. Nezávislý archiv dokumentů pro Horní Moštěnici.

**Stav:** funguje knihovna, prohlížeč a správa souborů nad skutečnou databází a úložištěm.
Nahraný soubor se uloží, zapíše do databáze a AI přečte jeho obsah. Potom se zveřejní.
Obrázek dostane zmenšený náhled. Chat odpovídá z dokumentů a uvádí zdroje.

- Návrh: [`docs/superpowers/specs/2026-11-11-archiv-obce-design.md`](docs/superpowers/specs/2026-11-11-archiv-obce-design.md)
- Návrh chatu: [`docs/superpowers/specs/2026-11-12-chat-design.md`](docs/superpowers/specs/2026-11-12-chat-design.md)
- Scénáře: [`features/README.md`](features/README.md)

## První spuštění

```bash
cp .env.example .env          # doplň SESSION_SECRET a ADMIN_PASSWORD_HASH
pnpm install
pnpm db:up                    # Postgres v Dockeru na portu 5434 (poprvé se sestaví obraz)
pnpm db:migrate
pnpm db:seed                  # nepovinné: ukázkové dokumenty (smaže stávající obsah)
pnpm dev
```

Heslo správce: `pnpm admin:password <heslo>` vypíše řádek pro `.env`.

## Příkazy

| Příkaz | Co dělá |
| --- | --- |
| `pnpm dev` | Spustí aplikaci na `http://localhost:3000`. |
| `pnpm check` | Typy, lint, formát a jednotkové testy. |
| `pnpm test:e2e` | Playwright testy proti serveru a databázi `hm_archiv_e2e`. S oknem: `--ui`. |
| `pnpm db:generate` | Po změně `src/db/schema.ts` vytvoří migraci. |
| `pnpm db:migrate` | Použije migrace a založí výchozí kategorie. |
| `pnpm db:seed` | Nahradí obsah archivu ukázkovými dokumenty. Jen pro místní úložiště. |
| `pnpm categories:assign` | Určí kategorii zpracovaným dokumentům, které ji ještě nemají. `--all` i těm, které ji dostaly od modelu. |
| `pnpm chat:index` | Připraví pro chat dokumenty zpracované dřív. `--all` připraví znovu všechny. |
| `pnpm demo:files` | Znovu vytvoří ukázkové soubory v `public/demo`. Potřebuje Google Chrome. |

## Úložiště souborů

| Kdy | Kam jdou soubory |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` je prázdný | Složka `STORAGE_DIR` (výchozí `.data/storage`). Vývoj a testy. |
| `BLOB_READ_WRITE_TOKEN` je vyplněný | Vercel Blob se soukromým přístupem. Prohlížeč posílá soubor přímo tam. |

Soubory se vždy čtou přes aplikaci (`/soubor/<id>`, náhled `/soubor/<id>/nahled`).
Nezveřejněný dokument tak návštěvník neotevře.

## Zpracování obsahu

Po nahrání prohlížeč správce zavolá zpracování dokumentu. Výsledek je ve sloupcích tabulky `documents`:

| Sloupec | Obsah |
| --- | --- |
| `auto_description` | PDF: text ze všech stran. Obrázek: krátký odstavec o tom, co na něm je. |
| `short_description` | Jedna až dvě věty. Knihovna je ukazuje pod názvem. |
| `custom_description` | Popis od správce. Když je vyplněný, knihovna ukáže ten. |
| `title` | Název, který model určí z obsahu. Název zadaný správcem model nepřepíše. |
| `category_id` | Kategorie od rozhodovacího modelu, pokud ji správce nezadal sám. |
| `original_filename` | Původní název souboru. Knihovna ho ukazuje menším písmem pod názvem. |

Kategorii určuje rozhodovací model Jev (`AI_DECISION_MODEL`, `src/server/ai/categorizer.ts`): dostane název,
krátký popis, začátek textu a seznam kategorií archivu a vrátí pravděpodobnost každé z nich. Volba méně jistá
než `AI_CATEGORY_CONFIDENCE` (výchozí 0,7) jde do „Nezařazené“. Kategorii zadanou správcem nepřepíše.

PDF se čte po stranách (`src/server/pdf-text.ts`, `src/server/processing.ts`). Strana jen s textem
se přečte přímo z textové vrstvy. Strana bez textové vrstvy (sken) se vyjme a přečte ji model.
Strana, kde je k textu i obrázek nebo tabulka s čarami, se vyjme a model ji přepíše celou: tabulku
jako tabulku v Markdownu, na místo obrázku řádek „[Obrázek: …]“. Když model takovou stranu
nepřečte, použije se její textová vrstva. Dokument se zveřejní, jen když zpracování skončí dobře. Jinak má stav
„Chyba“ s důvodem a správce ho spustí znovu tlačítkem „Zpracovat znovu“.

Modely se nastavují v `.env` ve tvaru `dodavatel:model` (`openai` nebo `anthropic`):

| Proměnná | K čemu | Výchozí |
| --- | --- | --- |
| `AI_OCR_MODEL` | Čte skeny a popisuje obrázky. | `openai:gpt-6.1-terra` |
| `AI_DESCRIPTION_MODEL` | Píše název a krátký popis z textu. | `openai:gpt-6-luna` |

Klíč je v `OPENAI_API_KEY` nebo `ANTHROPIC_API_KEY`. Testy používají dodavatele `fake` s pevnou odpovědí.

## Záznamy, skilly a náklady

- **Záznamy volání**: každé volání modelu se zapíše do tabulky `ai_usage`: model, skilly a jejich
  verze, co model dostal, co vrátil, chyba, doba, tokeny a cena. Zpracování dokumentu ukazuje panel
  ladění na stránce „Zpracování“, otázky chatu stránka „Ladění chatu“.
- **Skilly** (`/sprava/skilly`): skill je text v Markdownu, podle kterého model pracuje. Jsou ve dvou
  skupinách: zpracování dokumentů a obrázků, a chat. Každá skupina má jeden systémový prompt.
  Každý skill říká, na kterých místech se použije (`SKILL_USES` v `src/server/ai/skills/types.ts`).
  Kód ke každému volání sám složí systémový prompt skupiny a skilly toho místa (`instructionsFor`).
  Výchozí skilly jsou soubory `.md` ve složce `src/server/ai/skills/<skupina>/`. Správce je na stránce
  upravuje a přidává vlastní; jeho texty jsou v databázi (`skill_versions`, `custom_skills`) a každé
  uložení je nová verze.  Záznam každého volání říká, které skilly a v jaké verzi dostalo.
- **Náklady** (`/sprava/naklady`): součty podle modelu a typu souboru. Ceny modelů jsou
  v `src/server/ai/prices.ts`, proměnná `AI_PRICES` je doplní nebo opraví. Cena je `[vstup, výstup]`,
  volitelně i `[…, čtení z cache, zápis do cache]`; bez nich stojí vstup z cache jako ostatní vstup.

Nahrává se z přehledu dokumentů tlačítkem „Nahrát“. Okno soubory uloží a zavře se, obsah se
potom zpracuje na pozadí a přehled ukazuje stav každého dokumentu. Obrázek se otevírá v okně
přes stránku, PDF v prohlížeči na místě seznamu.

## Rozhraní

- **Hlavička** je jedna pro celou aplikaci (`src/components/AppHeader.tsx`). Návštěvník vidí položku
  „Dokumenty“. Správce vidí navíc „Zpracování“ (přehled dokumentů se stavy a tlačítkem „Nahrát“) a nabídku „Správa“ (Kategorie, Skilly, Náklady, Ladění chatu).
- **RSS** (`/rss.xml`, `src/server/feed.ts`): 50 nejnověji přidaných zveřejněných dokumentů. Odkaz je ikona v hlavičce vedle účtu.
- **Knihovna**: hledání, přepínač zobrazení, štítky kategorií (ty, které se nevejdou, jsou v nabídce „Další“), rok a řazení.
  Prvních pět kategorií má záložku, ostatní jsou pod „Další kategorie“.
- **Řádek seznamu** otevře dokument. Sloupec „Akce“ má ikony s popiskem po najetí: otevřít, stáhnout
  a šipku „Zeptat se na dokument“, která dokument přidá do výběru pro chat.
- **Chat** začíná polem pro otázku a příklady. „Zeptat se na dokument“ omezí odpověď na jeden dokument.
- Aplikace nemá uživatelské účty. Hlavička proto ukazuje jen „Návštěvník“ nebo „Správce archivu“.

## Hledání a stránkování

Hledá server, ne prohlížeč. Funkce je v `src/server/search-service.ts`.

- Hledání je fulltextové (Postgres, sloupec `documents.search_vector` s indexem GIN). Prochází název,
  název souboru, popisy a celý text dokumentu. Nerozlišuje diakritiku ani velikost písmen.
- Dokument odpovídá, když má ke každému hledanému slovu slovo, které jím začíná. Skloňování
  hledání nezná: „rozpočet“ nenajde „rozpočtu“, „rozpoč“ najde obojí.
- Výsledky hledání se řadí podle shody. Shoda v názvu váží nejvíc, shoda v textu nejmíň.
  Když se slovo našlo v textu, seznam ukáže úryvek „V textu: …“.
- Seznam v knihovně ukáže prvních 10 dokumentů a tlačítko „Zobrazit další“ přidá dalších 10; počet je v adrese (`pocet`). Seznam je seskupený podle dne přidání a řadí se výběrem řazení.
- Přehled ve správě má 10 dokumentů na stránku (jde zvolit 20 nebo 50) a řadí se kliknutím na záhlaví sloupce.
- Migrace `0005` potřebuje rozšíření `unaccent` a zakládá konfiguraci hledání `cs_simple`.

## Chat

Návštěvník se zeptá, model si nástrojem vyžádá hledání a odpoví jen z nalezených úryvků.
Podrobnosti jsou v návrhu chatu.

- **Kousky.** Zpracování rozdělí dokument na kousky (tabulka `document_chunks`) a ke každému
  uloží embedding. Dokumenty zpracované dřív připraví `pnpm chat:index`.
- **Hybridní hledání.** Větev slov je BM25 (rozšíření `pg_textsearch`). Větev významu jsou
  embeddingy (rozšíření `pgvector`). Pořadí spojuje RRF. Kód: `src/server/chat/retrieval.ts`.
- **Rozhodovací model** (Jev od TypeSafe, `src/server/chat/decisions.ts`). U každého hledání dělá dvě věci,
  každou vlastním voláním. Před spojením určí váhy větví: dotaz na přesná slova posílí BM25, dotaz vlastními
  slovy embeddingy. Po spojení ohodnotí 20 nejlepších úryvků číslem 0 až 1 (reranker) a modelu jde 6 nejlepších.
  Volání jsou dvě záměrně: váhy musí být známé dřív, než se vyberou úryvky pro reranker.
  Když Jev selže nebo chybí klíč, platí pořadí RRF se stejnými vahami.
  Hledání vždy uloží i to pořadí bez něj. Odpověď ho nepoužije, ladění ho ukáže vedle pro porovnání.
- **Výpočty** (nástroj `spocitej`, `src/server/chat/sandbox.ts`). Když odpověď potřebuje součet, průměr
  nebo změnu v procentech, model napíše skript v JavaScriptu a čísla z úryvků mu dá jako parametry.
  Skript běží v QuickJS (WebAssembly) bez sítě, souborů a Node. Engine má pevně 64 MB paměti a běží
  ve vlastním vlákně (`src/server/chat/sandbox-worker.ts`). Když skript nedoběhne do 1,5 s, server
  vlákno zastaví zvenku, takže pomalý skript nikdy nezdrží zbytek serveru. Build musí mít QuickJS jako
  soubory: `traceDeps` ve `vite.config.ts`. Do `CHAT_MAX_CALCULATIONS` se počítá jen skript, který doběhl bez chyby. Skript
  s chybou model opraví, chybných běhů smí být nejvýš `CHAT_MAX_ERRORED_RUNS`. Návštěvník vidí jen
  výsledek se zdroji, skript je v ladění. Kdy a jak počítat říká skill `chat/pocitani`.
- **Ladění** (`/sprava/chat`): u každé otázky celý postup. Volání modelu, obě větve hledání se skóre,
  váhy větví, skóre rerankeru, texty úryvků, výpočty, odpověď, cena. Správce tam může položit zkušební otázku.
- **Cache promptu.** Každý krok smyčky posílá modelu znovu zadání, nástroje a předchozí kroky. Poskytovatel
  ten začátek drží v cache a účtuje ho levněji: OpenAI sám (`promptCacheKey`), Anthropic po zapnutí
  `cacheControl`. Obojí nastavuje `src/server/chat/answerer.ts`. Ladění u každého volání ukazuje, kolik
  vstupních tokenů přišlo z cache, a cena je s tím počítaná.
- **Limity.** `CHAT_HOURLY_LIMIT` na návštěvníka za hodinu, `CHAT_DAILY_LIMIT` celkem za den.

| Co změnit | Kde |
| --- | --- |
| Zadání pro model | `src/server/chat/instructions.ts` |
| Počty úryvků, velikost kousků, limity | `src/server/chat/settings.ts` nebo proměnné `CHAT_*` |
| Modely | `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL` (embedding musí mít 1536 čísel) |
| Váhy větví a reranker | `AI_DECISION_MODEL` (`off` vypne obojí), klíč `TYPESAFE_API_KEY`, čísla `CHAT_WEIGHT_SPREAD` a `CHAT_RERANK_CANDIDATES` |

Databáze potřebuje rozšíření `unaccent`, `vector` a `pg_textsearch`. Poslední se musí načíst při
startu serveru (`shared_preload_libraries`). Místní obraz je v `docker/postgres/Dockerfile`.

## Kde co je

| Složka | Obsah |
| --- | --- |
| `src/archive` | Data: typy, parametry hledání a úložiště `store.ts`. |
| `src/library` | Veřejná knihovna: nástroje, filtry a tři způsoby zobrazení. |
| `src/viewer` | Prohlížeč PDF a obrázků. |
| `src/admin`, `src/routes/sprava*` | Správa archivu. |
| `src/server` | Serverové funkce, přihlášení, úložiště souborů, náhledy, zpracování obsahu. |
| `src/server/ai` | Jediné místo, které zná dodavatele AI a modely. |
| `src/server/ai/skills` | Výchozí znění skillů, ve složce podle typu souboru (`pdf`, `image`, `shared`). |
| `src/chat` | Panel chatu na hlavní stránce. |
| `src/server/chat` | Chat na serveru: kousky, embeddingy, hybridní hledání, smyčka s modelem, stopy. |
| `src/db` | Schéma databáze, migrace, ukázková data. |
| `src/routes/soubor*`, `src/routes/api` | Vydávání a příjem souborů. |
| `src/copy/cs.ts` | Všechny texty rozhraní. |

## Ikony

- Čárové ikony jsou ze sady [Lucide](https://lucide.dev) (licence ISC), všechny v `src/components/Icon.tsx`.
- Typ souboru ukazuje barevný lístek s příponou (`src/components/FileBadge.tsx`). Písma jsou Public Sans a IBM Plex Mono (obě licence OFL) z balíčků Fontsource.
