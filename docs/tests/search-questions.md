# Testovací otázky pro hledání

Sada 20 otázek nad skutečnými dokumenty archivu (264 dokumentů v databázi `hm_archiv_dev`).
Každá otázka má odpověď ověřenou přímo v textu dokumentu a k ní dokumenty, které musí hledání
najít. Slouží k měření hledání před a po každé změně (konfigurace BM25, rozšíření dotazu o tvary,
váhy větví).

**Jak číst sloupce**

- **Otázka**: přesně tak, jak by ji napsal návštěvník, včetně chybějící diakritiky a překlepů.
- **Správné dokumenty**: hledání je musí vrátit mezi prvními výsledky. Strana je strana PDF.
- **Past**: proč je otázka těžká, tedy čím se hledání může splést.

## Přehled případů

| Případ | Otázky |
|---|---|
| Krátký dokument, konkrétní číslo | 1, 9, 10 |
| Dlouhý dokument, odpověď hluboko uvnitř | 6, 13 |
| Opakující se slova, mnoho podobných dokumentů | 3, 12, 13, 14 |
| Skloňování (jiný tvar v otázce než v textu) | 4, 7, 11 |
| Jiná slova než v textu (synonyma) | 5, 15, 16 |
| Bez diakritiky, překlep | 1, 3, 9 |
| Datum | 4, 12 |
| Odpověď složená z více dokumentů | 2, 14, 16, 19 |
| Vývoj v čase, starší a novější stav | 18, 19 |
| Odpověď jen nepřímo (hlavní dokument v archivu chybí) | 8 |
| Text poškozený OCR | 17 |
| Tabulka s čísly | 11 |
| Odpověď v archivu není | 20 |

## Otázky

### 1. Poplatek za psa

- **Otázka:** kolik se plati poplatek za psa
- **Odpověď:** 200 Kč za každého psa za kalendářní rok. Splatný do 30. 6. příslušného roku.
- **Správné dokumenty:** Obecně závazná vyhláška o místním poplatku ze psů (2023), s. 2
- **Past:** bez diakritiky. Rušit může vyhláška o pohybu psů (č. 1/2013).

### 2. Změna poplatku za odpad

- **Otázka:** Jak se změnil poplatek za odpad v roce 2026 oproti roku 2025?
- **Odpověď:** V roce 2025 platil poplatek za obecní systém odpadového hospodářství 800 Kč za
  kalendářní rok, splatný do 30. června. Od roku 2026 platí poplatek za odkládání komunálního
  odpadu z nemovité věci: 1 Kč za litr, minimální základ dílčího poplatku 60 l za kalendářní
  měsíc, splatný do 30. června následujícího roku.
- **Správné dokumenty:**
  - Obecně závazná vyhláška o místním poplatku za obecní systém odpadového hospodářství (2025), s. 2
  - Obecně závazná vyhláška o místním poplatku za odkládání komunálního odpadu z nemovité věci (2026), s. 2–3
- **Past:** odpověď potřebuje oba dokumenty. Rušit může vyhláška o stanovení obecního systému
  odpadového hospodářství (2026), která o výši poplatku nemluví.

### 3. Dotace na zásahové obleky

- **Otázka:** kolik dostali hasici od kraje na zasahovy obleky
- **Odpověď:** Dotace 51 000 Kč od Olomouckého kraje v roce 2023. Celkové výdaje 112 206 Kč,
  vlastní zdroje 61 206 Kč.
- **Správné dokumenty:** Dotace Olomouckého kraje pro SDH Horní Moštěnice na zásahové obleky 2023, s. 1
- **Past:** pět skoro stejných dokumentů o hasičských dotacích od kraje (2019, 2021, 2022, 2023
  a JSDH), liší se jen rokem, předmětem a částkou. Navíc chybí diakritika a „zasahovy“ je překlep.

### 4. Výsadba stromů

- **Otázka:** Kdy se sázely stromy z dotace od SFŽP?
- **Odpověď:** Od 1. 4. 2020 do 4. 5. 2020. Dotace SFŽP 249 500 Kč z celkových 356 486 Kč.
- **Správné dokumenty:** Dotace SFŽP na akci Výsadba stromů v obci Horní Moštěnice, s. 1
- **Past:** text říká „výsadba“ a „zahájení / ukončení“, ne „sázely“. Rušit mohou žádosti
  o informace o výsadbě stromů na pozemku p.č. 9/5 (2026) a o náhradní výsadbě za dálnici D0136.

### 5. Baterie fotovoltaiky na škole

- **Otázka:** Jak velkou baterii má solární elektrárna na škole?
- **Odpověď:** Kapacita akumulace 41,60 kWh. Projekt sníží emise o 24,48 t CO2 za rok.
- **Správné dokumenty:** Dotace Modernizačního fondu na FVE na střeše školy v Horní Moštěnici, s. 1
- **Past:** text používá „fotovoltaická elektrárna“, „FVE“ a „akumulace elektrické energie“, nikde
  „solární“ ani „baterie“. Rušit může dotace na vzduchotechniku ve škole a FVE na víceúčelové
  budově ve střednědobém výhledu rozpočtu.

### 6. Změna územního plánu u plochy Z11

- **Otázka:** Proč obec mění územní plán u plochy Z11?
- **Odpověď:** Změna č. 1 zvyšuje koeficient zastavění plochy Z11 z 0,5 na 0,9. Umožní tak
  stavbu průmyslové haly pro skladování pneumatik. Plocha leží v severním cípu katastru
  u hranice s Přerovem.
- **Správné dokumenty:** Změna č. 1 Územního plánu Horní Moštěnice – textová část a odůvodnění, s. 24
- **Past:** nejdelší dokument archivu (99 stran, 454 kusů textu). Slova „územní plán“ jsou v něm
  skoro všude.

### 7. Oprava topení ve škole

- **Otázka:** Kdo opravuje topení ve škole?
- **Odpověď:** Firma Trasko inženýrské stavby, s.r.o., na základě nejvýhodnější nabídky. Smlouvu
  o dílo č. 240-IS-009-0-26 na opravu topení pavilonů ZŠ schválila Rada obce 6. 5. 2026
  (usnesení č. 96/2026, bod 13).
- **Správné dokumenty:** Usnesení Rady obce č. 96/2026 ze dne 6. 5. 2026, s. 1
- **Past:** text má „opravu topení pavilonů ZŠ“, otázka „topení ve škole“. Rušit může položka
  „Výměna topení v ZŠ a MŠ 1 500 000 Kč“ ve střednědobém výhledu rozpočtu. Usnesení rady je
  v archivu přes 100 a vypadají skoro stejně.

### 8. Zákaz volebních plakátů

- **Otázka:** Podle jakého zákona rada zakázala volební plakáty mimo vyhrazené plochy?
- **Odpověď:** Podle zákona č. 234/2025, § 4 odst. 2. Podkladem byl přípis Magistrátu města
  Přerova (registrační úřad), č. j. MMPr 146380/2026 ze dne 19. 8. 2026.
- **Správné dokumenty:** Poskytnutí informací: bod č. 9 usnesení Rady obce č. 106/2026, plochy
  pro volební plakáty (30. 9. 2026), s. 2
- **Past:** samotné usnesení rady č. 106/2026 v archivu není. Odpověď je jen v odpovědi na
  žádost o informace.

### 9. Obecní byty

- **Otázka:** kolik ma obec obecnich bytu
- **Odpověď:** 14 bytů. Obsazenost za poslední 3 roky 100 %, žádný byt není nezpůsobilý
  k bydlení (stav 14. 10. 2025).
- **Správné dokumenty:** Poskytnutí informace: byty ve vlastnictví obce (14. 10. 2025), s. 1
- **Past:** bez diakritiky. Rušit mohou žádost o informace o bytech a dokumenty o dotaci na
  sociální byty.

### 10. Dodavatel plynu

- **Otázka:** Od koho obec kupuje plyn?
- **Odpověď:** Plyn dodává Pražská plynárenská, elektřinu Epet. Roční spotřeba plynu
  186,157 MWh, elektřiny 45,747 MWh. Smlouvy na dobu určitou do 08/2028 s automatickým
  prodloužením. Údaje platí pro obecní objekty bez ZŠ a MŠ.
- **Správné dokumenty:** Žádost o informace a odpověď obce: dodávky elektřiny a plynu
  (22. 12. 2025), s. 2
- **Past:** strana 1 je jen žádost se stejnými slovy („dodavatel“, „plyn“), odpověď je až na
  straně 2. Text má OCR chyby.

### 11. Rozpočet na nový obecní úřad

- **Otázka:** Kolik obec počítá na stavbu nového obecního úřadu a kulturního domu v roce 2027?
- **Odpověď:** 31 000 000 Kč (položka „Výstavba OÚ a KD“). Všechny investiční akce na rok 2027
  dohromady 44 000 000 Kč.
- **Správné dokumenty:** Střednědobý výhled rozpočtu na rok 2027 (aktualizovaný), s. 1
- **Past:** odpověď je v tabulce pod zkratkou „OÚ a KD“. Rušit může Architektonická studie:
  Novostavba obecního úřadu a přístavba kulturního domu, která o stavbě mluví hodně, ale částku
  pro rok 2027 nemá.

### 12. Schválení rozpočtu na rok 2024

- **Otázka:** Kdy zastupitelstvo schválilo rozpočet na rok 2024?
- **Odpověď:** 29. 11. 2023, usnesení Zastupitelstva obce č. 7, bod 4.
- **Správné dokumenty:** Usnesení Zastupitelstva obce č. 7 ze dne 29. 11. 2023, s. 1
- **Past:** stejná věta „Rozpočet obce Horní Moštěnice pro rok …“ je i v usneseních č. 2
  (rok 2023), č. 13 (rok 2025) a č. 19 (rok 2026). Rozhoduje jen číslo roku.

### 13. Obyvatelé ulice Pod Vinohrady

- **Otázka:** Kolik lidí bydlelo v roce 2024 v ulici Pod Vinohrady?
- **Odpověď:** 217 osob. Ulice je druhá nejlidnatější po ulici Dr. A. Stojana (227 osob).
  Celá obec měla k 1. 12. 2024 1 696 obyvatel.
- **Správné dokumenty:** Moštěnský zpravodaj 1/2025, s. 7
- **Past:** zpravodaj má přes 50 stran. Stejný článek „Statistika pohybu osob“ vychází každý rok
  v čísle 1, takže zpravodaje 1/2022 až 1/2026 mají skoro stejný text s jinými čísly. Údaje
  v čísle 1/2025 platí pro rok 2024.

### 14. Původ zpomalovacích prvků

- **Otázka:** Od koho obec získala zpomalovací prvky v ulici U Rybníka a kdo rozhodl o jejich použití?
- **Odpověď:** Prvky přenechala firma Fajn silnice s.r.o. (IČO 09287221) jako dlouhodobě
  nepotřebný, už použitý materiál. Nebyl to majetkový dar, do majetku obce se nezapsaly.
  Převzal je starosta Ing. Vladimír Martínek. O jejich použití rozhodla Rada obce 4. 3. 2026.
- **Správné dokumenty:**
  - Poskytnutí informace: bezplatné předání zpomalovacích prvků (18. 5. 2026), s. 1
  - Poskytnutí informací: zpomalovací prvek U Rybníka, č. j. 773/2026 (3. 6. 2026), s. 1
- **Past:** k zpomalovacímu prvku je v archivu přes 15 dokumentů (žádosti, rozhodnutí,
  odvolání, rozhodnutí krajského úřadu). Většina z nich odpověď neobsahuje.

### 15. Volné pobíhání psů

- **Otázka:** Kde můžu pustit psa z vodítka?
- **Odpověď:** U Štulbachu (p.č. 970/1, 970/5, 970/6), u areálu bývalého statku (p.č. 646/3,
  646/4), u rybníku (p.č. 985/2), podél obchvatu (p.č. 1299) a za obchvatem (p.č. 306). Pes musí
  být pod neustálým dohledem doprovázející osoby.
- **Správné dokumenty:** Obecně závazná vyhláška č. 1/2013 o pravidlech pro pohyb psů na veřejném
  prostranství, s. 1
- **Past:** text říká „volné pobíhání psů“, ne „pustit z vodítka“. Rušit může vyhláška
  o poplatku ze psů.

### 16. Postoj obce k větrným elektrárnám

- **Otázka:** Co si obec myslí o větrnících?
- **Odpověď:** Obec s větrnými elektrárnami zásadně nesouhlasí. Zastupitelstvo 4. 3. 2026
  (usnesení č. 21, bod 6) vyslovilo zásadní nesouhlas s umístěním větrné elektrárny v katastru
  obce a blízkém okolí i se zákonem č. 249/2025 Sb. a poslalo nesouhlas hejtmanovi Olomouckého
  kraje. Návrh připravila Rada obce 2. 2. 2026 (usnesení č. 88/2026, bod 11).
- **Správné dokumenty:**
  - Usnesení Zastupitelstva obce č. 21 ze dne 4. 3. 2026, s. 1
  - Usnesení Rady obce č. 88/2026 ze dne 2. 2. 2026, s. 1
- **Past:** slovo „větrník“ v archivu není. Rušit může zamítnutá žádost spolku MY A BUDOUCNOST
  o informace k větrným elektrárnám (3. 2. 2026), která postoj obce neobsahuje.

### 17. Správce veřejného osvětlení

- **Otázka:** Která firma se stará o veřejné osvětlení?
- **Odpověď:** Ondřej Martínek (IČ 75176785, Havlíčkova 418/27, Horní Moštěnice) a JD ROZHLASY
  s.r.o. (IČ 27797007, Horní Bečva 968). Stav k 4. 11. 2024.
- **Správné dokumenty:** Žádost a poskytnutí informace: správce veřejného osvětlení (4. 11. 2024), s. 2
- **Past:** naskenovaný dokument s OCR chybami („VaŠí“, „Rřístupu“, „Vladim r“).

### 18. Školský obvod

- **Otázka:** Které obce patří do školského obvodu ZŠ Horní Moštěnice?
- **Odpověď:** Rada obce 6. 5. 2026 (usnesení č. 96/2026, bod 15) odsouhlasila školský obvod
  pro obce Beňov, Dobrčice, Líšná, Přestavlky, Říkovice a Stará Ves. Vyhláška k tomu měla jít
  na další zastupitelstvo. Starší vyhláška č. 4/2012 stanovila společný školský obvod jen
  s obcí Říkovice.
- **Správné dokumenty:**
  - Usnesení Rady obce č. 96/2026 ze dne 6. 5. 2026, s. 1
  - Obecně závazná vyhláška č. 4/2012, kterou se stanoví část společného školského obvodu, s. 1
- **Past:** starší a novější stav si odporují. Dobrá odpověď uvede nový stav a řekne, že vyhláška
  z roku 2012 je starší.

### 19. Pozemek p.č. 1408/5

- **Otázka:** Co se stalo s pozemkem p.č. 1408/5?
- **Odpověď:** Jde o obecní pozemek o výměře 14 m². 6. 5. 2026 rada zařadila na program záměr
  odprodeje (usnesení č. 96/2026, bod 17). 18. 5. 2026 místo toho vyhlásila záměr pronájmu
  (č. 97/2026, bod 7). 15. 6. 2026 schválila nájemní smlouvu s občanem (č. 99/2026, bod 6).
  Pozemek se tedy pronajal, neprodal.
- **Správné dokumenty:**
  - Usnesení Rady obce č. 96/2026 ze dne 6. 5. 2026, s. 1
  - Usnesení Rady obce č. 97/2026 ze dne 18. 5. 2026, s. 1
  - Usnesení Rady obce č. 99/2026 ze dne 15. 6. 2026, s. 1
- **Past:** číslo parcely je přesný řetězec, který vektory neumí. Odpověď vyžaduje všechna tři
  usnesení a jejich pořadí.

### 20. Parkovací dům

- **Otázka:** Plánuje obec stavět parkovací dům?
- **Odpověď:** V archivu o tom nic není. Chat to má říct a nemá si nic domýšlet.
- **Správné dokumenty:** žádné
- **Past:** k parkování existují dokumenty o ulici Nábřežní (parkování a obratiště). Chat je
  nesmí vydávat za odpověď.
