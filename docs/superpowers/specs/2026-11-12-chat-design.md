# Chat nad archivem: návrh

Datum: 12. 11. 2026. Navazuje na `2026-11-11-archiv-obce-design.md`.

## Cíl

Návštěvník napíše otázku. Aplikace najde v dokumentech místa, která s otázkou souvisí,
a model z nich složí odpověď. Odpověď uvádí zdroje: dokument a stranu. Správce vidí
u každé otázky celý postup krok za krokem.

## Postup jedné otázky

1. Prohlížeč pošle otázku, předchozí zprávy konverzace a rozsah (celý archiv, nebo
   dokumenty, které právě ukazuje seznam).
2. Server zkontroluje limity. Návštěvník má strop za hodinu, celý chat strop za den.
3. Model dostane zadání, konverzaci a jeden nástroj: `hledej_v_archivu(dotaz)`.
   V prvním kroku nástroj použít musí. Dotaz si píše sám, proto zvládne i navazující
   otázku („a kolik to stálo?“).
4. Nástroj udělá hybridní hledání (viz níže) a vrátí očíslované úryvky.
5. Model odpoví, nebo hledá znovu jinými slovy. Nejvýš 3 hledání na otázku. V posledním
   kroku už hledat nesmí a musí odpovědět, nebo říct, že to v archivu není.
6. Server z odpovědi vybere použitá čísla `[n]`, přečísluje je od jedné a vrátí odpověď
   se zdroji.
7. Celý postup se uloží jako stopa (`chat_traces`) a každé volání modelu do `ai_usage`.

Konverzaci drží prohlížeč. Server si ji nepamatuje. Do dalšího kola jdou jen otázky
a odpovědi, ne úryvky z minulých hledání. Kontext tak neroste.

## Data

Tabulka `document_chunks`: jeden řádek je kousek textu dokumentu.

| Sloupec | Obsah |
| --- | --- |
| `document_id`, `page`, `position` | Odkud kousek je. Obrázek nemá stranu. |
| `text` | Text, který dostane model a který se ukáže ve stopě. |
| `indexed` | Název dokumentu a text. Nad ním je index BM25. |
| `embedding`, `embedding_model` | Vektor a model, který ho vyrobil. |

Kousky vznikají při zpracování dokumentu. PDF se dělí po stranách. Strana delší než
1 200 znaků se dělí dál na hranici odstavce nebo věty, s překryvem 150 znaků.
Pro starší dokumenty je příkaz `pnpm chat:index`.

## Hybridní hledání

| Větev | Čím | Co najde |
| --- | --- | --- |
| Slova | BM25, rozšíření `pg_textsearch`, konfigurace `cs_simple` (bez diakritiky) | Přesná slova, čísla, jména. |
| Význam | Embedding, rozšíření `pgvector`, kosinová vzdálenost, index HNSW | Totéž jinými slovy. |

Každá větev vrátí 20 nejlepších kousků. Spojí je RRF: skóre kousku je součet
`váha / (60 + pořadí)` přes obě větve. Hledá se jen ve zveřejněných dokumentech
a v rozsahu, který návštěvník zvolil.

### Rozhodovací model

Jev od TypeSafe nevrací text, ale typované odpovědi s pravděpodobností. U každého
hledání dělá dvě rozhodnutí (`src/server/chat/decisions.ts`):

| Kdy | Otázka pro Jev | Co s odpovědí |
| --- | --- | --- |
| Před spojením, souběžně s větvemi | Je dotaz na přesná slova, na význam, nebo na obojí? | Váha slov je `1 + (P(přesná) − P(význam)) × 0,5`, váha významu je zbytek do 2. |
| Po spojení | Pomáhá úryvek odpovědět na otázku? Jedna otázka za každý z 20 nejlepších úryvků, vše v jednom volání. | Úryvky se seřadí podle pravděpodobnosti. Modelu jde 6 nejlepších. |

Jsou to dvě volání záměrně. Váhy určují, kterých 20 úryvků reranker dostane, proto musí
být známé před ním. Sloučení do jednoho volání by z vah udělalo jen rozhodčího mezi
úryvky se stejným skóre. Volání vah běží souběžně s větvemi, takže odpověď nezdržuje.

Když Jev selže, nemá klíč nebo je `AI_DECISION_MODEL=off`, mají větve váhu 1
a modelu jde 6 nejlepších podle RRF. Chyba je vidět v ladění.

Každé hledání spočítá i pořadí bez rozhodovacího modelu: RRF se stejnými vahami, 6 nejlepších.
Odpověď ho nepoužije. Stopa ho uloží (`baseline`) i se skóre rerankeru a textem, aby ladění
ukázalo obě pořadí vedle sebe.

Vestavěný `ts_rank` Postgresu není BM25: nepočítá vzácnost slova ani délku dokumentu.
Proto je tu `pg_textsearch`. Hledání v seznamu knihovny zůstává na `tsvector`,
protože potřebuje hledat podle začátku slova.

## Bezpečnost a peníze

- Text dokumentu je pro model data, ne příkaz. Říká to zadání.
- Model odpovídá jen z úryvků. Když v nich odpověď není, řekne to.
- Limity: `CHAT_HOURLY_LIMIT` otázek na návštěvníka za hodinu, `CHAT_DAILY_LIMIT` celkem za den.
  Správce limit nemá.
- Otázky návštěvníků se ukládají do stopy. Adresa návštěvníka jen jako otisk.

## Ladění

Stránka `/sprava/chat` ukazuje poslední otázky. U každé je časová osa:

- volání modelu: co vrátil, jaké hledání si vyžádal, tokeny, doba, cena;
- hledání: dotaz, výsledky větve BM25 se skóre, výsledky větve embeddingů se vzdáleností,
  váhy větví s důvodem, skóre rerankeru u každého kandidáta a text kousků, které šly modelu;
- konečná odpověď, zdroje, nastavení a zadání platné v tu chvíli.

Správce tam může položit zkušební otázku. Co se dá měnit:

| Co | Kde |
| --- | --- |
| Zadání pro model | `src/server/chat/instructions.ts` |
| Počty, limity, velikost kousků | `src/server/chat/settings.ts`, nebo proměnné `CHAT_*` v `.env` |
| Modely | `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`, `AI_DECISION_MODEL` v `.env` |

## Co návrh nedělá

- Odpověď se neposílá po částech (streaming). Návštěvník vidí „Hledám v dokumentech…“.
- Zadání chatu není skill, takže ho optimalizátor nenavrhuje.
- Změna názvu dokumentu nepřepíše `indexed` ani embedding. Pomůže „Zpracovat znovu“.
- `pg_textsearch` musí být na serveru databáze (`shared_preload_libraries`). Neon ho podle
  dokumentace nenabízí. Nasazení potřebuje vlastní Postgres nebo Tiger Cloud, případně
  se větev BM25 přepíše na to, co hostitel nabízí. Větev je v jedné funkci.
