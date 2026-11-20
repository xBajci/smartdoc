Feature: Ladění chatu
  Správce vidí otázky z chatu po rozhovorech. U každé otázky vidí celý postup: historii, kterou
  model dostal, volání modelu, hledání v obou větvích, váhy větví, skóre rerankeru, úryvky pro
  model a konečnou odpověď. Může položit zkušební otázku, a to i do otevřeného rozhovoru.
  Návštěvník může každou odpověď ohodnotit. Správce hodnocení vidí u otázky a rozhovory podle něj filtruje.

  Scenario: Bez přihlášení není postup otázek vidět
    When nepřihlášený návštěvník otevře stránku ladění chatu
    Then vidí jen přihlašovací formulář

  Scenario: Zkušební otázka ukáže celý postup krok za krokem
    Given správce je na stránce "Ladění chatu" a nikdo se zatím nezeptal
    When položí zkušební otázku "Kdo vymění veřejné osvětlení?"
    Then otevře se nový rozhovor a záznam otázky ukazuje 1 hledání
    And krok 1 je volání modelu, který žádá hledání
    And hledání ukazuje větev slov (BM25) se skóre a větev významu (embedding) se vzdáleností
    And hledání ukazuje váhy větví s důvodem a tabulku rerankeru se skóre každého úryvku
    And porovnání ukazuje úryvky, které by model dostal bez rozhodovacího modelu, se skóre rerankeru
    And pořadí po rerankeru ukazuje úryvek "[1] Zápis z 9. zasedání zastupitelstva", strana 2, s textem
    And krok 2 je volání modelu s odpovědí
    And nastavení ukazuje čísla chatu a zadání pro model

  Scenario: Otázka návštěvníka je v ladění a její cena v nákladech
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?" a potom "Kolik?"
    When správce otevře ladění chatu
    Then vidí jeden rozhovor se 2 otázkami
    When rozhovor otevře
    Then u otázky "Kolik?" jsou 2 hledání, druhé s předchozí otázkou
    When otevře "Náklady"
    Then vidí řádek modelu chatu

  Scenario: Dvě otázky jednoho chatu jsou jeden rozhovor
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?" a potom "Kolik?"
    When správce otevře ladění chatu
    Then vidí jeden rozhovor nazvaný podle první otázky, s počtem otázek 2
    When rozhovor otevře
    Then vidí id rozhovoru s tlačítkem "Kopírovat id"
    And vidí obě otázky, nejstarší první

  Scenario: Druhá otázka ukazuje historii, kterou model dostal
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?" a potom "Kolik?"
    When správce otevře rozhovor a záznam otázky "Kolik?"
    Then blok "Historie pro model" ukazuje otázku návštěvníka a odpověď archivu s firmou "Elektro Haná"
    And záznam první otázky říká, že model žádnou historii nedostal

  Scenario: Správce pokračuje v rozhovoru zkušební otázkou
    Given správce položil zkušební otázku "Kdo vymění veřejné osvětlení?" a rozhovor je otevřený
    When položí zkušební otázku "Kolik?"
    Then rozhovor má 2 otázky
    And záznam otázky "Kolik?" má v historii pro model první otázku a 2 hledání

  Scenario: „Nový rozhovor“ začne nový rozhovor
    Given správce položil zkušební otázku "Kdo vymění veřejné osvětlení?" a rozhovor je otevřený
    When zvolí "Nový rozhovor"
    Then vidí seznam rozhovorů s jedním rozhovorem
    When položí zkušební otázku "Kolik?"
    Then otevře se rozhovor s jedinou otázkou "Kolik?" bez historie
    And v seznamu rozhovorů jsou 2 rozhovory

  Scenario: Otázka se známým id rozhovoru naváže na rozhovor a historii dodá server
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?"
    When správce otevře rozhovor návštěvníka a položí v něm zkušební otázku "Kolik?"
    Then rozhovor má 2 otázky
    And záznam otázky "Kolik?" má v historii pro model otázku návštěvníka a 2 hledání

  Scenario: Otázka s neznámým id rozhovoru začne nový rozhovor
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?"
    And záznamy chatu byly smazány, takže id rozhovoru v prohlížeči už nikdo nezná
    When návštěvník se zeptá "Kolik?"
    Then vznikl nový rozhovor s jiným id než ten smazaný
    And správce v něm vidí jedinou otázku "Kolik?" bez historie s 1 hledáním

  Scenario: Neúspěšná otázka není v historii další otázky
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?", potom "selhani" a potom "Kolik?"
    When správce otevře rozhovor
    Then rozhovor má 3 otázky a je označený chybou
    And historie pro model u otázky "Kolik?" má 2 zprávy a "selhani" v ní není

  Scenario: Otázka s hodnocením má štítek a rozhovor ukazuje počty hodnocení
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?" a odpověď ohodnotil "Odpověď pomohla"
    And potom se zeptal "Kolik?" a odpověď ohodnotil "Odpověď nepomohla"
    And potom se zeptal "Co je ve 4/2025?" a odpověď neohodnotil
    When správce otevře ladění chatu
    Then rozhovor má štítky "Pomohla: 1" a "Nepomohla: 1"
    When rozhovor otevře
    Then otázka "Kdo vymění veřejné osvětlení?" má štítek "Pomohla"
    And otázka "Kolik?" má štítek "Nepomohla"
    And otázka "Co je ve 4/2025?" žádný štítek hodnocení nemá

  Scenario: Filtr ukáže jen rozhovory s hodnocením, jen s kladným, nebo jen se záporným
    Given v rozhovoru "Kdo vymění veřejné osvětlení?" je odpověď ohodnocená "Odpověď pomohla"
    And v rozhovoru "Kolik?" je odpověď ohodnocená "Odpověď nepomohla"
    And v rozhovoru "Otevírací doba zoologické zahrady" žádné hodnocení není
    When správce otevře ladění chatu
    Then filtr "Hodnocení" má zvoleno "Vše" a seznam má 3 rozhovory
    When zvolí "S hodnocením"
    Then seznam má rozhovory "Kolik?" a "Kdo vymění veřejné osvětlení?"
    When zvolí "Kladné"
    Then seznam má jen rozhovor "Kdo vymění veřejné osvětlení?"
    When zvolí "Záporné"
    Then seznam má jen rozhovor "Kolik?"
    When zvolí "Vše"
    Then seznam má 3 rozhovory

  Scenario: Rozhovor s kladným i záporným hodnocením je v obou filtrech
    Given návštěvník se v chatu zeptal "Kdo vymění veřejné osvětlení?" a odpověď ohodnotil "Odpověď pomohla"
    And potom se zeptal "Kolik?" a odpověď ohodnotil "Odpověď nepomohla"
    When správce v ladění chatu zvolí filtr "Kladné"
    Then seznam má rozhovor "Kdo vymění veřejné osvětlení?"
    When zvolí "Záporné"
    Then seznam má rozhovor "Kdo vymění veřejné osvětlení?"

  Scenario: Filtr zůstane po novém načtení stránky
    Given v rozhovoru "Kdo vymění veřejné osvětlení?" je odpověď ohodnocená "Odpověď pomohla"
    When správce v ladění chatu zvolí filtr "Záporné"
    Then vidí "Žádný rozhovor s tímto hodnocením."
    And adresa stránky končí "?hodnoceni=zaporne"
    When stránku načte znovu
    Then filtr "Hodnocení" má zvoleno "Záporné" a vidí "Žádný rozhovor s tímto hodnocením."
    When zvolí "Kladné"
    Then seznam má jen rozhovor "Kdo vymění veřejné osvětlení?"
