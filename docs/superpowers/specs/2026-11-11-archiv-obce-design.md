# Archiv obce: návrh první verze

**Datum:** 11. listopadu 2026
**Podklad:** Produktové zadání archivu dokumentů pro Horní Moštěnici, verze 1.0

Tento návrh pokrývá první dodávku: knihovnu, prohlížeč, administraci a zpracování souborů.
Chat a hledání v obsahu (RAG) přijdou v další dodávce s vlastním návrhem.

## 1. Rozsah

### Je v této dodávce

- Veřejná knihovna: režimy Seznam, Mřížka a Náhled, filtry podle kategorie a roku, tlačítko „Filtry“.
- Hledání v seznamu podle zobrazovaného názvu a popisu dokumentu.
- Integrovaný prohlížeč pro PDF a obrázky (JPG, JPEG, PNG) se stažením originálu.
- Administrace za heslem: nahrání jednoho souboru i dávky, stavy zpracování, úprava metadat,
  správa kategorií, opakování zpracování, odstranění dokumentu.
- Zpracování na pozadí: kontrola formátu, text ze stran, OCR, automatický popis, náhled.

### Není v této dodávce

- Chat, citace a hledání podle obsahu nebo významu (RAG). Žádné embeddingy.
- Formáty DOC, DOCX, XLS, XLSX a TXT. Nahrání je odmítne jako nepodporovaný formát.
- Úryvky z obsahu ve výsledcích hledání.
- Veřejné účty, komentáře, schvalování, verze souborů.

### Připraveno pro další dodávku

Text každé strany se ukládá už teď. Chat ho později použije bez nového zpracování souborů.
Rozložení stránky počítá s pravým panelem pro chat, ale v této dodávce se panel nezobrazuje.
Knihovna zabírá celou šířku.

## 2. Technologie

Stejný základ jako projekt hormos (`/Users/xbajci/Code/martin.bajcar/hormos`):

| Vrstva | Volba |
|---|---|
| Web | TanStack Start, TanStack Router, React 19, Vite, Nitro |
| Databáze | Postgres, ovladač `pg`, Drizzle ORM a drizzle-kit |
| Soubory | Vercel Blob |
| AI | AI SDK (`ai`) s přímými klíči: `@ai-sdk/anthropic`, později `@ai-sdk/openai` |
| PDF | `pdfjs-dist` (prohlížeč i server), `pdf-lib` (vyjmutí jedné strany) |
| Obrázky | `sharp` |
| Kontroly | TypeScript, oxlint, oxfmt, cspell, vitest, Playwright |
| Běh | Node 24.21.0, pnpm 12.6.0, Vercel (tarif Hobby stačí) |

Odchylky od hormos:

- **Vzhled:** vlastní neutrální styl. Vládní design systém se nepoužije, protože archiv nesmí
  působit jako web obce.
- **Přihlášení:** bez better-auth. Jedno heslo nepotřebuje knihovnu pro uživatelské účty.

Agentní soubory jsou v `.agents/`, složka `.claude/` na ně jen odkazuje.

## 3. Datový model

**`categories`**: `id`, `name`, `slug`, `position`, `is_fallback`.
Výchozí řádky: Rozpočty, Smlouvy, Plány a projekty, Zpravodaje, Zápisy, Fotografie, Nezařazené.
Kategorie Nezařazené má `is_fallback = true` a nejde odstranit. Odstranění jiné kategorie
přesune její dokumenty do Nezařazené.

**`documents`**

| Sloupec | Význam |
|---|---|
| `id` | Stabilní identifikátor (UUID). |
| `original_filename`, `title` | Původní název souboru a upravitelný zobrazovaný název. |
| `format`, `size_bytes`, `sha256` | Skutečný formát, velikost, otisk obsahu. `sha256` je unikátní. |
| `blob_path`, `thumbnail_path` | Originál a náhled ve Vercel Blob. |
| `category_id` | Kategorie. |
| `added_at` | Datum vložení do archivu. |
| `issued_date`, `issued_year` | Datum a rok vydání. Zpracování zkusí rok vyčíst z dokumentu, správce ho může zadat nebo opravit. Hodnota od správce má přednost. Prázdné znamená „Neznámý rok“. |
| `custom_description`, `auto_description` | Vlastní a automatický popis jako oddělené údaje. |
| `status` | `queued`, `processing`, `ready`, `failed`. |
| `has_text` | `false` znamená upozornění „Bez čitelného textu“. |
| `error_reason` | Srozumitelný důvod chyby pro správce. |
| `page_count`, `processing_version` | Počet stran a verze zpracování. |

Zobrazovaný popis je `custom_description`, a když je prázdný, `auto_description`.
Stav „Nahrává se“ existuje jen v prohlížeči správce, v databázi není.

**`document_pages`**: `document_id`, `page_number`, `text`, `text_source` (`layer` nebo `ocr`),
`width`, `height`. Unikátní dvojice (`document_id`, `page_number`). Obrázek má jednu stranu.

**`processing_jobs`**: `document_id` (unikátní), `step`, `next_page`, `attempts`, `locked_until`,
`last_error`. Jeden řádek na dokument, proto opakování nevytvoří duplicitu.

**`login_attempts`**: `ip_hash`, `attempted_at`. Slouží k omezení chybných pokusů o přihlášení.

## 4. Nahrání

1. Správce vybere nebo přetáhne soubory. U každé položky vidí název, velikost, kategorii,
   pole „Vlastní popis · nepovinné“ a možnost položku odebrat.
2. Prohlížeč zkontroluje příponu a limity a spočítá `sha256`.
3. Server ověří relaci správce a duplicitu. U duplicity nabídne otevření existujícího dokumentu
   a nový záznam nezaloží.
4. Server vydá jednorázové oprávnění a prohlížeč pošle soubor přímo do Vercel Blob. Funkce
   na Vercelu totiž přijme tělo jen do 4,5 MB.
5. Po dokončení přenosu server založí řádek v `documents` (`queued`) a v `processing_jobs`
   a spustí zpracování.

Každý soubor jde samostatně. Chyba jednoho souboru nezastaví ostatní.
Před nahráním stránka ukazuje podporované formáty, limity a větu, že se připravený dokument
zveřejní automaticky.

Výchozí limity (nastavitelné v `.env`): soubor 50 MB, dávka 20 souborů, PDF 300 stran.

## 5. Zpracování na pozadí

Fronta je tabulka `processing_jobs`. Pracovník je obyčejná funkce na Vercelu.

**Spouštění**

- Nahrání spustí pracovníka přes `waitUntil`, takže správce nečeká.
- Pracovník si bere úlohy dotazem `FOR UPDATE SKIP LOCKED` a nastaví `locked_until`.
- Po zhruba 240 sekundách skončí. Pokud zbývá práce, zavolá sám sebe přes interní adresu
  chráněnou tajným klíčem.
- Denní cron uvolní úlohy s propadlým zámkem a spustí pracovníka. Slouží jako pojistka.

**Kroky pro jeden dokument**

1. **Kontrola formátu** podle prvních bajtů souboru, ne podle přípony.
2. **Text ze stran.** U PDF se čte textová vrstva přes `pdfjs-dist`. Strana bez textu se vyjme
   přes `pdf-lib` a pošle modelu k OCR. Obrázek se pošle modelu celý. Postup se po každé straně
   uloží do `next_page`, takže přerušený běh pokračuje od poslední hotové strany.
3. **Automatický popis.** Model napíše stručný věcný popis ze získaného textu. Krok se přeskočí,
   když je `custom_description` vyplněný nebo když dokument nemá text.
4. **Náhled.** První strana PDF nebo zmenšený obrázek jako WebP.
5. **Dokončení.** Stav `ready`, dokument se zveřejní.

**Pravidla**

- Zápis stran je `upsert`, proto opakování nevytvoří duplicitní strany.
- Opakování zachová `custom_description`.
- Po třech neúspěšných pokusech je stav `failed` s důvodem. Neúplný výsledek se nezveřejní.
- Dokument bez získaného textu skončí jako `ready` s `has_text = false`.
- Model dostává obsah dokumentu jako data. Pokyny uvnitř dokumentu nemění jeho úkol.
- Rok vydání zpracování zkusí vyčíst z textu dokumentu. Když si není jisté, nechá ho prázdný.
  Hodnotu zadanou správcem nepřepíše. Kategorii zpracování nedomýšlí.

**Modely** se nastavují v `.env` ve tvaru `dodavatel:model`:

| Proměnná | Role | Výchozí hodnota |
|---|---|---|
| `AI_OCR_MODEL` | Čtení skenů a obrázků | `openai:gpt-6.1-terra` |
| `AI_DESCRIPTION_MODEL` | Název a krátký popis | `openai:gpt-6-luna` |
| `AI_OPTIMIZER_MODEL` | Hodnocení záznamů a návrhy skillů | `openai:gpt-6.1-sol` |

Jeden modul `src/server/ai/models.ts` převádí tyto hodnoty na model z AI SDK. Zbytek kódu
dodavatele nezná.

## 6. Veřejná knihovna

- **Horní lišta:** „Archiv obce“, výrazně „Horní Moštěnice“, text „Nezávislá knihovna dokumentů“.
- **Nástroje:** hledání, výběr kategorie, výběr roku, „Filtry“, přepínač Seznam / Mřížka / Náhled.
- **Seznam:** sloupce „Název dokumentu“, „Kategorie“, „Přidáno“. Bez sloupce „Typ“, formát
  ukazuje ikona. Pod názvem je krátký popis.
- **Bez** bočního menu kategorií a bez velkých nadpisů.
- **Hledání:** podle `title` a zobrazovaného popisu. Nerozlišuje velikost písmen ani diakritiku
  (rozšíření `unaccent`). Dokument musí obsahovat všechna hledaná slova.
- **Rok:** filtruje podle `issued_year`, s volbou „Neznámý rok“.
- **Aktivní filtry** jsou vidět jako štítky a každý jde zrušit.
- **Prázdné stavy:** jiná zpráva pro prázdný archiv a jiná pro hledání bez výsledků.
  Druhá nabízí zrušení filtrů.
- **Načítání:** po 50 položkách.
- **Stav v adrese:** hledání, filtry, režim a řazení jsou v parametrech URL. Návrat z dokumentu
  proto obnoví vše včetně pozice v seznamu.
- **Zápatí:** nenápadný odkaz „Správa archivu“.
- Veřejně jsou vidět jen dokumenty ve stavu `ready`.

## 7. Integrovaný prohlížeč

Prohlížeč nahradí obsah knihovny, neotvírá novou kartu. Adresa nese `doc` a `page`.

- **Společné ovládání:** „Zpět na seznam“, název dokumentu, „Stáhnout“, „Zvětšit“.
- **PDF:** `pdfjs-dist` v prohlížeči. Předchozí a další strana, zadání čísla strany, posouvání,
  zoom, přizpůsobení šířce. Strany se načítají postupně.
- **Obrázek:** zvětšení, zmenšení, posun, přizpůsobení oknu.
- **Chyba vykreslení:** zpráva s popisem omezení a tlačítko „Stáhnout“.
- Soubory jdou přes adresu aplikace `/soubor/$id`, která ověří stav `ready` nebo relaci správce.
  Rozpracovaný soubor tak veřejnost neotevře.

## 8. Administrace

- **Přihlášení:** jedno heslo. V `.env` je jen jeho otisk (`ADMIN_PASSWORD_HASH`, scrypt).
  Relace je podepsaná cookie (`SESSION_SECRET`), `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Omezení pokusů:** pět chybných pokusů za 15 minut z jedné adresy, pak srozumitelná zpráva.
- **Ochrana na serveru:** každá správcovská serverová funkce prochází jedním společným
  ověřením relace. Test hlídá, že žádná funkce ověření nevynechá.
- **Přehled dokumentů:** stav každé položky, upozornění „Bez čitelného textu“, důvod chyby.
- **Akce:** úprava názvu, kategorie, popisu a data vydání. Zobrazení originálu. Opakování
  zpracování. Odstranění s potvrzením, které jmenuje dokument a říká, co se smaže.
- **Odstranění** smaže řádek, strany, originál i náhled.
- **Kategorie:** přidat, přejmenovat, seřadit, odstranit.

## 9. Použitelnost a bezpečnost

- Rozhraní je česky. Vše jde ovládat klávesnicí a fokus je viditelný.
- Chyby a stavy mají text nebo ikonu, ne jen barvu.
- Na úzké obrazovce má knihovna vlastní rozložení, není to jen zmenšený desktop.
- Zpracování nespouští žádný aktivní obsah ze souborů.
- Tajné údaje jsou jen na serveru, nikdy v klientském kódu.

## 10. Testy

Podle zvyklostí z ostatních projektů: každá funkce má soubor `.feature` (anglická klíčová slova
Gherkin, české kroky) a odpovídající Playwright test. Jednotkový test jen tam, kde E2E nedává
smysl, například kontrola formátu, výběr úloh z fronty a převod názvu modelu.
V testech je AI nahrazena pevnou odpovědí, takže testy nestojí peníze a jsou opakovatelné.

Jeden `playwright.config.ts` a jeden příkaz `pnpm test:e2e`. Pravidla budou
v `docs/tests/bdd.md`.

## 11. Pořadí práce

**Krok A (teď): jen uživatelské rozhraní.** Celé rozhraní knihovny, prohlížeče a administrace
běží nad ukázkovými daty v prohlížeči. Datová vrstva je za jedním rozhraním
(`src/archive/store.ts`), které se později nahradí serverem. Přihlášení, nahrání a zpracování
jsou v tomto kroku jen napodobené a rozhraní to zřetelně označuje jako ukázku.

**Krok B (hotovo): soubory na serveru bez AI.** Databáze, přihlášení správce heslem, nahrání
do úložiště, úpravy, odstranění a kategorie. Nahraný dokument je hned ve stavu `ready`.
Obrázek dostane při nahrání zmenšenou kopii (WebP, delší strana 640 bodů, sloupec
`thumbnail_key`). Režim Náhled ukazuje tuto kopii, plná verze se načte až po otevření.
Rok vydání se zatím odhaduje jen z názvu souboru.

Odchylky od oddílů výše, které platí do kroku C:

- Tabulky `document_pages` a `processing_jobs` zatím neexistují.
- Seznam dokumentů se ze serveru načítá celý, dělení po 50 dělá prohlížeč.
- Otisk `sha256` počítá prohlížeč správce. Server kontroluje formát a velikost uloženého souboru.

**Krok C (hotovo): zpracování obsahu.** Po nahrání má dokument stav `queued`. Prohlížeč správce
zavolá zpracování (`processDocumentFn`), které dokument převezme (`processing`) a skončí stavem
`ready` nebo `failed`. Správce může zpracování spustit znovu.

- PDF se čte po stranách: textová vrstva přes `unpdf`, strana bez textu se vyjme přes `pdf-lib`
  a přečte ji model. Limit je 300 stran.
- Podle rozhodnutí zadavatele jde celý text PDF do sloupce `auto_description`. U obrázku je tam
  odstavec o obsahu obrázku. Tabulka `document_pages` proto neexistuje.
- Nový sloupec `short_description` (1 až 2 věty) ukazuje knihovna pod názvem. Vlastní popis
  správce má přednost. Hledání v seznamu prochází název a zobrazený popis, ne celý text.
- Název z obsahu dostane každý dokument (`title_source`). Knihovna pod názvem ukazuje menším
  písmem původní název souboru (`original_filename`) a hledá i podle něj. Název zadaný
  správcem zpracování nepřepíše. Rok vydání z obsahu nepřepíše rok zadaný správcem.
- Celý text se neposílá v seznamu dokumentů. Správce si ho načte v dialogu úprav.

Odchylky od oddílu 5: není tabulka `processing_jobs`, `waitUntil` ani cron. Frontu nahrazuje
sloupec `status` a `processing_started_at` (běh starší než 10 minut jde spustit znovu).
Dlouhý sken se musí přečíst v jednom běhu funkce. Náhled první strany PDF na serveru zatím není.

**Krok C2 (hotovo): záznamy, skilly, náklady a vzhled.**

- Každé volání modelu je řádek v `ai_usage`: skill a verze, model, vstup, výstup, chyba, doba,
  tokeny, cena. Správa je ukazuje jako „Záznamy AI“ a „Náklady“.
- Skilly mají výchozí znění v kódu (`src/server/ai/skills/<typ souboru>/`). Optimalizace je ruční
  tlačítko: silnější model přečte poslední záznamy, napíše hodnocení a navrhne nové znění.
  Návrh platí až po schválení správcem (`skill_versions`, stav `proposed` → `active`).
  Bezpečnostní větu o pokynech v dokumentu optimalizace měnit nemůže, je v kódu.
- Vzhled knihovny a správy podle dodaných návrhů. Panel chatu je zatím jen rozhraní.

**Krok D (později): chat** s hledáním v obsahu a citacemi.

## 12. Kritéria dokončení

Ze zadání platí pro tuto dodávku body 1 (bez hledání v obsahu), 2, 3, 5, 10, 11, 12, 13 a 14
(bez části o odpovědích). Z bodu 4 platí jen obrázek. Body 6 až 9 a 15 patří k chatu.

Kontrolní sada: běžné PDF, naskenované PDF, obrázek s textem, obrázek bez textu.
