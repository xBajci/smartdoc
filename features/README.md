# Scénáře

Každý `.feature` soubor má odpovídající Playwright test se stejným názvem ve složce `e2e/`.
Scénář v testu nese stejný název jako v `.feature` souboru.

| Scénáře | Test | Stav |
| --- | --- | --- |
| `public/knihovna.feature` | `e2e/public/knihovna.spec.ts` | automatizováno |
| `public/prohlizec.feature` | `e2e/public/prohlizec.spec.ts` | automatizováno |
| `admin/sprava.feature` | `e2e/admin/sprava.spec.ts` | automatizováno |
| `admin/nahravani.feature` | `e2e/admin/nahravani.spec.ts` | automatizováno |
| `admin/kategorie.feature` | `e2e/admin/kategorie.spec.ts` | automatizováno |
| `admin/skilly-ze-souboru.feature` | `e2e/admin/skilly-ze-souboru.spec.ts` | automatizováno |

Testy běží proti skutečnému serveru, databázi `hm_archiv_e2e` a úložišti ve složce
`.data/e2e-storage`. Před každým testem se archiv vrátí do stejného ukázkového stavu.
Potřebují běžící Postgres: `pnpm db:up`.

Scénář „Opakování neúspěšného zpracování“ čeká na zpracování na pozadí. Zatím není
automatizovaný ani implementovaný.

Spuštění: `pnpm test:e2e` (s oknem: `pnpm test:e2e --ui`).
