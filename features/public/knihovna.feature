Feature: Veřejná knihovna dokumentů
  Návštěvník bez přihlášení prochází dokumenty archivu.
  Hledání běží na serveru a prochází název, název souboru, popis i text dokumentu.
  Seznam ukáže prvních 10 dokumentů; tlačítko "Zobrazit další" přidá dalších 10.
  Seznam je seskupený podle dne přidání. Řadí se výběrem řazení. Řádek otevře dokument kliknutím.

  Scenario: Seznam ukazuje jen zveřejněné dokumenty
    Given archiv obsahuje připravené dokumenty i dokumenty ve zpracování
    When návštěvník otevře knihovnu
    Then vidí 12 dokumentů
    And seznam není tabulka a je seskupený podle dne přidání
    And řádek ukazuje kategorii a název souboru
    And hlavní nabídka má jen položku "Dokumenty"
    And tabulka nemá sloupec "Typ"
    And dokument "Zpravodaj 3/2025", který se zpracovává, v seznamu není

  Scenario: Hledání podle názvu nerozlišuje diakritiku
    When návštěvník hledá "schvaleny 2025"
    Then vidí dokument "Schválený rozpočet na rok 2025"
    And hledaná slova jsou v názvu zvýrazněná

  Scenario: Hledání podle popisu
    When návštěvník hledá "cisterna"
    Then vidí jen dokument "Zápis ze schůze zastupitelstva, září 1998"

  Scenario: Hledání se kombinuje s kategorií a rokem
    When návštěvník hledá "rozpočet"
    And zvolí záložku kategorie "Rozpočty" a rok "2026"
    Then vidí jen dokument "Návrh rozpočtu na rok 2026"
    And záložka "Rozpočty" je označená
    And výběr roku ukazuje "2026" a štítek "Rozpočty" ukazuje počet 1

  Scenario: Hledání bez výsledků nabídne zrušení filtrů
    When návštěvník hledá "kanalizace"
    Then vidí zprávu "Tomuto hledání neodpovídá žádný dokument"
    When zruší všechny filtry
    Then vidí 12 dokumentů

  Scenario: Oba způsoby zobrazení zachovají hledání
    Given návštěvník hledá "zápis"
    Then vidí 2 řádky seznamu a přepínač má jen "Seznam" a "Náhled"
    When přepne zobrazení na "Náhled"
    Then vidí 2 karty s náhledem
    And pole hledání stále obsahuje "zápis"

  Scenario: Karta s náhledem se vejde do své šířky i s dlouhým názvem souboru
    Given v archivu je dokument "Dlouhý název" s názvem souboru delším, než je karta široká
    When návštěvník ho najde v zobrazení "Náhled"
    Then obrázek ani text karty nepřesahují její okraj
    And název souboru je na jednom řádku a na konci zkrácený

  Scenario: Filtr podle neznámého roku
    When návštěvník vybere rok "Neznámý rok"
    Then vidí dokument "Kostel od polní cesty"
    And nevidí dokumenty se známým rokem

  Scenario: Nástroje: hledání, zobrazení, kategorie jako štítky, rok a řazení
    When návštěvník otevře knihovnu
    Then vidí pole hledání a přepínač zobrazení "Seznam" a "Náhled"
    And pod nimi štítky kategorií s počtem dokumentů a výběry "Rok" a "Řazení"
    And štítek "Všechny" je vybraný a ukazuje 12
    When klikne na štítek "Smlouvy"
    Then vidí jen smlouvy a štítek "Smlouvy" je vybraný

  Scenario: Kategorie, které se nevejdou, jsou v nabídce na konci řádku
    Given okno je tak úzké, že se štítky kategorií nevejdou na jeden řádek
    Then poslední položka řádku je nabídka "Další" se zbylými kategoriemi
    When návštěvník v nabídce zvolí "Fotografie"
    Then vidí jen fotografie
    And nabídka se zavře a její tlačítko se dál jmenuje "Další", zůstane na místě a je zvýrazněné
    And když je okno dost široké, nabídka "Další" není vidět

  Scenario: Vybraná je vždy jen jedna kategorie
    When návštěvník klikne na štítek "Smlouvy"
    Then štítek "Smlouvy" je vybraný, štítek "Všechny" vybraný není a vidí jen smlouvy
    When klikne na štítek "Rozpočty"
    Then vybraný je jen štítek "Rozpočty" a vidí jen rozpočty
    And po novém načtení stránky je výběr stejný
    When klikne znovu na štítek "Rozpočty"
    Then výběr se nezmění
    When klikne na štítek "Všechny"
    Then vidí znovu 12 dokumentů

  Scenario: Řádek otevře dokument kliknutím a má dvě akce jako ikony
    When návštěvník najede na řádek dokumentu "Návrh rozpočtu na rok 2026"
    Then řádek ukáže dvě ikony s popiskem: "Stáhnout" a "Zeptat se na dokument"
    When klikne na šipku "Zeptat se na dokument"
    Then dokument je vybraný pro otázku a neotevře se
    When klikne kamkoli do řádku
    Then dokument se otevře

  Scenario: Hlavička ukazuje návštěvníkovi jen dokumenty a přihlášení
    Then účet v hlavičce ukazuje "Návštěvník"
    When v nabídce účtu zvolí "Přihlásit se"
    Then vidí formulář "Přihlášení", který neříká, kam přihlášení vede
    When zadá heslo správce
    Then je zpět v knihovně a hlavička ukazuje roli "Správce" a nabídku správce

  Scenario: Seznam se řadí výběrem řazení
    Given návštěvník vidí seznam od nejnovějšího data dokumentu, seskupený podle měsíce nebo roku
    When zvolí řazení "Název od A do Z"
    Then první je dokument "Cyklostezka k nádraží, studie první etapy" a skupiny podle dne zmizí
    When zvolí řazení "Název od Z do A"
    Then první je dokument "Zpravodaj 4/2025" a řazení je v adrese stránky
    When zvolí řazení "Nejstarší"
    Then první je dokument s nejstarším datem a dokumenty bez data jsou poslední pod nadpisem "Bez data"
    When zvolí řazení "Naposledy přidané"
    Then první je nejnověji přidaný dokument a seznam je seskupený podle dne přidání
    When zvolí řazení "Nejnovější"
    Then řazení z adresy stránky zmizí

  Scenario: Hledání prochází i text dokumentu a ukáže nalezené místo
    Given text dokumentu "Zápis z 9. zasedání zastupitelstva" mluví o veřejném osvětlení
    When návštěvník hledá "verejne osvetleni"
    Then vidí jen dokument "Zápis z 9. zasedání zastupitelstva"
    And pod popisem je úryvek "V textu:" s nalezeným místem
    And hledaná slova jsou v úryvku zvýrazněná

  Scenario: Hledání najde slovo podle jeho začátku a řadí podle shody
    When návštěvník hledá "cyklost"
    Then první je dokument "Cyklostezka k nádraží, studie první etapy"
    And druhý je dokument "Zápis z 9. zasedání zastupitelstva", který slovo má jen v textu
    And řazení je "Nejlepší shoda"

  Scenario: Dlouhý seznam ukáže první dokumenty a další přidá sám při posunu
    Given archiv obsahuje 42 zveřejněných dokumentů
    When návštěvník otevře knihovnu
    Then vidí 10 dokumentů a text "Zobrazeno 10 z 42 dokumentů"
    When posune seznam na konec
    Then seznam sám přidá dalších 10 dokumentů a počet je v adrese stránky
    When klikne na tlačítko "Zobrazit další" uprostřed pod seznamem
    Then vidí 30 dokumentů
    When návštěvník hledá "vyhláška"
    Then seznam znovu ukazuje prvních 10 dokumentů

  Scenario: Když jsou vidět všechny dokumenty, tlačítko "Zobrazit další" zmizí
    Given archiv obsahuje 42 zveřejněných dokumentů
    When návštěvník otevře adresu s počtem 50
    Then vidí všech 42 dokumentů a tlačítko "Zobrazit další" není vidět
