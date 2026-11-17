Feature: Chat nad archivem
  Vedle knihovny je panel chatu. Návštěvník se zeptá a odpověď vychází jen z dokumentů archivu.
  Aplikace k otázce najde úryvky dokumentů (slova a význam) a model z nich odpoví se zdroji.
  V testech odpovídá náhradní model: cituje nejlepší nalezený úryvek.

  Scenario: Panel chatu je vedle seznamu dokumentů
    Given návštěvník je na hlavní stránce
    Then vedle seznamu vidí chat s polem "Napište otázku…"
    And vidí rozsah odpovědi "Celý archiv"
    And tlačítko pro odeslání je bez textu otázky neaktivní

  Scenario: Odpověď vychází z dokumentů a uvádí zdroj se stranou
    Given strana 2 dokumentu "Zápis z 9. zasedání zastupitelstva" mluví o výměně veřejného osvětlení
    When návštěvník se zeptá "Kdo vymění veřejné osvětlení?"
    Then odpověď obsahuje "Práce provede firma Elektro Haná za 870 000 Kč" a odkaz [1]
    And pod odpovědí je zdroj "Zápis z 9. zasedání zastupitelstva · str. 2"
    And vidí větu "Odpověď si ověřte v uvedených zdrojích."

  Scenario: Zdroj otevře dokument na uvedené straně a chat zůstane
    Given návštěvník dostal odpověď se zdrojem "Zápis z 9. zasedání zastupitelstva"
    When u zdroje zvolí "Otevřít"
    Then prohlížeč ukáže tento dokument na straně 2
    And odpověď v chatu je stále vidět

  Scenario: Číslo s lomítkem najde dokument, který ho obsahuje
    Given v archivu je "Zpravodaj 4/2025" a "Smlouva o dílo č. 14/2025, oprava chodníku"
    And smlouva zmiňuje rok 2025 víckrát než zpravodaj
    When návštěvník se zeptá "Co je ve 4/2025?"
    Then odpověď vychází z dokumentu "Zpravodaj 4/2025"

  Scenario: Když v archivu odpověď není, chat to řekne a neuvede zdroj
    When návštěvník se zeptá "Otevírací doba zoologické zahrady"
    Then odpověď je "V archivu jsem k tomu nic nenašel."
    And pod odpovědí nejsou žádné zdroje

  Scenario: Navazující otázka použije předchozí konverzaci
    Given návštěvník se zeptal "Kdo vymění veřejné osvětlení?"
    When se zeptá "Kolik?"
    Then druhá odpověď obsahuje "870 000 Kč" ze stejného dokumentu

  Scenario: „Nový chat“ začne konverzaci od začátku
    Given chat bez položené otázky tlačítko "Nový chat" neukazuje
    And návštěvník se zeptal "Kdo vymění veřejné osvětlení?"
    When zvolí "Nový chat"
    Then chat je prázdný, nabízí ukázkové otázky a pole otázky má kurzor
    When se zeptá "Kolik?"
    Then odpověď na předchozí konverzaci nenavazuje

  Scenario: Po vyčerpání denního počtu otázek chat otázku nepřijme
    Given návštěvníci dnes položili tolik otázek, kolik chat za den dovolí
    When návštěvník se zeptá "Kdo vymění veřejné osvětlení?"
    Then vidí zprávu "Chat má pro dnešek vyčerpaný počet otázek. Zkuste to zítra."

  Scenario: Chyba při odpovědi se ohlásí a další otázka projde
    When odpověď na otázku selže
    Then návštěvník vidí zprávu "Odpověď se nepodařilo získat. Zkuste to prosím znovu."
    When se zeptá "Kdo vymění veřejné osvětlení?"
    Then dostane odpověď se zdrojem

  Scenario: Na úzké obrazovce se chat otevírá tlačítkem
    Given návštěvník má úzkou obrazovku
    Then chat není vidět
    When zvolí "Zeptat se archivu"
    Then vidí chat přes celou obrazovku
    When chat zavře
    Then vidí znovu seznam dokumentů

  Scenario: „Zeptat se na dokument“ omezí odpověď na vybrané dokumenty
    Given není vybraný žádný dokument, proto chat rozsah odpovědi neukazuje
    When návštěvník u dokumentu "Kostel od polní cesty" zvolí "Zeptat se na dokument"
    Then chat píše "Chat prohledá jen vybrané dokumenty (1)", dokument je v seznamu výběru a pole otázky má kurzor
    When se zeptá "Kdo vymění veřejné osvětlení?"
    Then chat odpoví, že v archivu nic nenašel
    When přidá dokument "Zápis z 9. zasedání zastupitelstva" a zeptá se znovu
    Then odpověď uvádí firmu "Elektro Haná"
    When košem odebere zápis a zeptá se znovu
    Then chat odpoví, že v archivu nic nenašel
    When košem odebere i poslední dokument
    Then rozsah odpovědi zmizí a odpověď znovu uvádí firmu "Elektro Haná"
    When vybere dva dokumenty a klikne na "Odebrat vše"
    Then výběr je prázdný a chat znovu prohledává celý archiv

  Scenario: Otevřený dokument lze vybrat pro otázku přímo v prohlížeči
    Given návštěvník má otevřený dokument "Schválený rozpočet na rok 2025" a chat prohledává celý archiv
    When v prohlížeči zvolí "Zeptat se na dokument"
    Then chat píše "Chat prohledá jen vybrané dokumenty (1)" a tlačítko hlásí "Vybráno pro otázku"
    When se zeptá "Kdo vymění veřejné osvětlení?"
    Then chat odpoví, že v archivu nic nenašel
    When se vrátí na seznam
    Then dokument "Schválený rozpočet na rok 2025" je v seznamu označený jako vybraný
    When dokument znovu otevře a zvolí "Vybráno pro otázku"
    Then rozsah odpovědi zmizí
