Feature: Správa archivu
  Správa je dostupná po zadání hesla. Heslo ověřuje server.

  Scenario: Bez přihlášení správa ukazuje jen přihlašovací formulář
    When návštěvník otevře správu archivu
    Then vidí pole "Heslo"
    And nevidí seznam dokumentů ani nahrávání

  Scenario: Nesprávné heslo má srozumitelnou zprávu
    When návštěvník zadá nesprávné heslo
    Then vidí zprávu "Heslo není správné. Zkuste to znovu."

  Scenario: Opakované chybné pokusy se omezí
    When návštěvník zadá pětkrát nesprávné heslo
    Then vidí zprávu o příliš mnoha chybných pokusech
    And ani správné heslo ho nepřihlásí

  Scenario: Správce vidí stavy všech dokumentů
    Given správce je přihlášený
    Then u dokumentu "Zpravodaj 3/2025" vidí stav "Zpracovává se"
    And u dokumentu "Kronika obce, rok 1952" vidí stav "Chyba" a důvod chyby
    And u dokumentu "Kostel od polní cesty" vidí upozornění "Bez čitelného textu"

  Scenario: Změna metadat se projeví v knihovně
    Given správce je přihlášený
    When u dokumentu "Smlouva o nájmu společenského sálu" změní název na "Nájem sálu, vzorová smlouva" a rok vydání na 2024
    Then knihovna ukazuje dokument "Nájem sálu, vzorová smlouva"
    And dokument se najde ve filtru roku "2024"

  Scenario: Odstranění vyžaduje potvrzení a dokument zmizí z knihovny
    Given správce je přihlášený
    When odstraní dokument "Hodový průvod" a potvrdí to
    Then knihovna dokument "Hodový průvod" neukazuje

  Scenario: Odstranění kategorie přesune dokumenty do Nezařazené
    Given správce je přihlášený
    When odstraní kategorii "Fotografie"
    Then dokument "Kostel od polní cesty" má kategorii "Nezařazené"

  Scenario: Bez přihlášení server odmítne správcovské operace i nezveřejněný soubor
    When návštěvník bez přihlášení požádá o soubor nezveřejněného dokumentu
    Then server odpoví, že soubor neexistuje
    When návštěvník bez přihlášení pošle soubor k nahrání
    Then server nahrání odmítne
    And knihovna ukazuje jen zveřejněné dokumenty

  Scenario: Odhlášení ukončí správcovskou relaci
    Given správce je přihlášený
    When se odhlásí
    Then správa ukazuje přihlašovací formulář
    And přihlašovací formulář zůstane i po novém načtení stránky

  Scenario: Správce si obrázek zobrazí na místě seznamu
    Given správce je přihlášený
    When u obrázku "Kostel od polní cesty" zvolí "Zobrazit"
    Then obrázek se ukáže ve stejném prohlížeči jako v knihovně, na místě seznamu
    And neotevře se okno přes stránku ani nová karta
    And panel ladění vpravo je o stejném dokumentu
    When zvolí "Zpět na seznam"
    Then vidí zase přehled dokumentů

  Scenario: Správce si PDF prohlédne na místě seznamu a může ho stáhnout
    Given správce je přihlášený
    When u dokumentu "Zpravodaj 4/2025" zvolí "Zobrazit"
    Then PDF se ukáže na místě seznamu se stránkováním a nová karta se neotevře
    And tlačítkem "Stáhnout" stáhne původní soubor
    When zvolí "Zpět na seznam"
    Then vidí zase přehled dokumentů

  Scenario: Přehled dokumentů se dělí na stránky a umí hledat
    Given archiv obsahuje 45 dokumentů ve všech stavech
    When správce otevře přehled dokumentů
    Then vidí 10 dokumentů a pod tabulkou text "1–10 z 45 dokumentů"
    When klikne na "Další"
    Then vidí text "11–20 z 45 dokumentů"
    When zvolí 50 řádků na stránku
    Then vidí všech 45 dokumentů
    When klikne na záhlaví "Dokument"
    Then první je dokument "Cyklostezka k nádraží, studie první etapy"
    When klikne na záhlaví "Přidáno"
    Then první je nejnověji přidaný dokument
    When vybere stav "Chyba"
    Then vidí jen dokument "Kronika obce, rok 1952"
    When zruší filtr stavu a hledá "osvetleni"
    Then vidí jen dokument "Zápis z 9. zasedání zastupitelstva"

  Scenario: Přehled má stejné nástroje jako knihovna: kategorie, stav a rok
    Given správce je v přehledu dokumentů
    Then vidí hledání, štítky kategorií a výběry "Stav" a "Rok"
    And nevidí přepínač zobrazení
    When klikne na štítek "Smlouvy"
    Then vidí jen smlouvy
    When klikne na štítek "Rozpočty"
    Then vidí jen rozpočty
    When ve výběru "Rok" zvolí "2026"
    Then vidí jen dokumenty z roku 2026

  Scenario: Hlavička vede správce k nahrávání, zpracování a správě
    Given správce je přihlášený
    Then účet v hlavičce ukazuje "Správce"
    When zvolí "Dokumenty"
    Then vidí knihovnu a hlavní nabídka zůstává
    When zvolí "Zpracování"
    Then vidí přehled dokumentů s tlačítkem "Nahrát"
    When otevře nabídku "Správa"
    Then vidí "Kategorie", "Skilly", "Náklady" a "Ladění chatu"
