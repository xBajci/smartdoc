Feature: Chat nad archivem
  Vedle knihovny je panel chatu. Návštěvník se zeptá a odpověď vychází jen z dokumentů archivu.
  Aplikace k otázce najde úryvky dokumentů (slova a význam) a model z nich odpoví se zdroji.
  Když odpověď potřebuje výpočet, model napíše skript a spustí ho v izolovaném prostředí bez sítě a souborů.
  V testech odpovídá náhradní model: cituje nejlepší nalezený úryvek. Na otázku se slovem "celkem"
  sečte částky v korunách z nalezených úryvků.

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

  Scenario: Otázka na výpočet dostane spočítaný výsledek se zdroji, bez skriptu
    Given strana 2 zápisu uvádí osvětlení za 870 000 Kč a strana 3 dotace spolkům 240 000 Kč
    When návštěvník se zeptá "Kolik obec dá celkem za osvětlení a dotace spolkům?"
    Then odpověď obsahuje "Celkem 1 110 000 Kč" a odkazy [1] a [2]
    And pod odpovědí jsou zdroje "Zápis z 9. zasedání zastupitelstva" se stranou 2 i se stranou 3
    And odpověď neukazuje skript ani parametry výpočtu

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

  Scenario: Během hledání chat ukazuje, co právě dělá
    When návštěvník se zeptá a hledání chvíli trvá
    Then pod otázkou vidí vždy jen jeden krok a každý další nahradí předchozí
    And kroky jdou za sebou "Přemýšlím nad otázkou", "Prohledávám dokumenty", "Řadím výsledky", "Analyzuji výsledky", "Ještě poslední kontrola" a "Přidávám zdroje"
    And krok, který trvá déle než sekundu, má na konci běžící tečky ".", "..", "..."
    And když odpověď dorazí, postup zmizí a zůstane odpověď se zdrojem

  Scenario: Když v archivu odpověď není, chat to řekne a neuvede zdroj
    When návštěvník se zeptá "Otevírací doba zoologické zahrady"
    Then odpověď je "V archivu jsem k tomu nic nenašel."
    And pod odpovědí nejsou žádné zdroje

  Scenario: Navazující otázka použije předchozí rozhovor
    Given návštěvník se zeptal "Kdo vymění veřejné osvětlení?"
    When se zeptá "Kolik?"
    Then druhá odpověď obsahuje "870 000 Kč" ze stejného dokumentu

  Scenario: „Nový chat“ začne rozhovor od začátku
    Given chat bez položené otázky tlačítko "Nový chat" neukazuje
    And návštěvník se zeptal "Kdo vymění veřejné osvětlení?"
    When zvolí "Nový chat"
    Then chat je prázdný, nabízí ukázkové otázky a pole otázky má kurzor
    When se zeptá "Kolik?"
    Then odpověď na předchozí rozhovor nenavazuje

  Scenario: Hodnocení je pod každou odpovědí, pod hlášením chyby není
    When odpověď na otázku selže
    Then pod hlášením chyby není žádné hodnocení
    When návštěvník se zeptá "Kdo vymění veřejné osvětlení?" a potom "Kolik?"
    Then pod každou z obou odpovědí jsou tlačítka "Odpověď pomohla" a "Odpověď nepomohla"
    And žádné z nich není označené jako zvolené

  Scenario: Návštěvník ohodnotí odpověď a hodnocení může změnit
    Given návštěvník se zeptal "Kdo vymění veřejné osvětlení?"
    When pod odpovědí zvolí "Odpověď pomohla"
    Then tlačítko "Odpověď pomohla" je označené jako zvolené a vidí "Děkujeme za hodnocení."
    And otázka "Kdo vymění veřejné osvětlení?" má uložené kladné hodnocení
    When zvolí "Odpověď nepomohla"
    Then jako zvolené je označené jen tlačítko "Odpověď nepomohla"
    And otázka "Kdo vymění veřejné osvětlení?" má uložené záporné hodnocení

  Scenario: Každá odpověď má své hodnocení
    Given návštěvník se zeptal "Kdo vymění veřejné osvětlení?" a potom "Kolik?"
    When první odpověď ohodnotí "Odpověď pomohla" a druhou "Odpověď nepomohla"
    Then u první odpovědi je zvolené "Odpověď pomohla" a u druhé "Odpověď nepomohla"
    And otázka "Kdo vymění veřejné osvětlení?" má uložené kladné hodnocení a otázka "Kolik?" záporné

  Scenario: Hodnocení odpovědi, jejíž záznam byl smazán, se neuloží
    Given návštěvník se zeptal "Kdo vymění veřejné osvětlení?"
    And záznamy chatu byly smazány
    When pod odpovědí zvolí "Odpověď pomohla"
    Then vidí "Hodnocení se nepodařilo uložit." a žádné tlačítko není označené jako zvolené
    And žádné hodnocení uložené není

  Scenario: Otázka a její hodnocení dorazí do MLflow
    Given návštěvník se zeptal "Kdo vymění veřejné osvětlení?"
    Then MLflow dostal záznam té otázky do experimentu chatu, přihlášený účtem chatu
    And záznam ukazuje i hledání s úryvky, které našlo
    When pod odpovědí zvolí "Odpověď nepomohla"
    Then MLflow dostal k záznamu té otázky hodnocení „nepomohla“ od návštěvníka
    When zvolí "Odpověď nepomohla" znovu a potom "Odpověď pomohla"
    Then MLflow má u záznamu pořád jen jedno hodnocení, změněné na „pomohla“

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
