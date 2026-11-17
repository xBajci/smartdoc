Feature: Zpracování obsahu dokumentu
  Po nahrání aplikace přečte obsah souboru pomocí AI.
  Uloží získaný text, krátký popis pro knihovnu a případně název.
  Zveřejní se jen dokument, jehož zpracování skončilo dobře.

  Scenario: Obrázek dostane název a popisy z obsahu a název souboru zůstane vidět
    Given správce nahrál obrázek "IMG_4521.jpg"
    Then dokument má název určený z obsahu obrázku
    And knihovna vedle názvu ukazuje menším písmem název souboru "IMG_4521.jpg"
    And knihovna v seznamu i v náhledech ukazuje krátký popis
    And dokument jde najít i podle názvu souboru
    And správce u dokumentu vidí delší popis obrázku

  Scenario: PDF s textovou vrstvou dostane název z obsahu a uloží celý text
    Given správce nahrál PDF "studie-stezky.pdf" s textovou vrstvou
    Then dokument má název určený z obsahu
    And knihovna vedle názvu ukazuje název souboru "studie-stezky.pdf"
    And knihovna ukazuje jeho krátký popis
    And správce u dokumentu vidí text ze všech stran

  Scenario: PDF bez textové vrstvy se přečte jako sken
    Given správce nahrál naskenované PDF "scan_0001.pdf"
    Then dokument má název určený z obsahu
    And správce u dokumentu vidí text přečtený ze skenu

  Scenario: PDF se smíšenými stranami se přečte celé
    Given správce nahrál PDF, kde první strana má text a druhá je sken
    Then získaný text obsahuje text první strany i text přečtený ze skenu

  Scenario: Stranu s textem a obrázkem přečte model, stranu jen s textem ne
    Given správce nahrál PDF, kde první strana má jen text a druhá text a fotografii
    Then panel ladění u rozboru stran ukazuje "Strana 1: jen text" a "Strana 2: text a obrázky"
    And model četl jen stranu 2 a dostal k ní její textovou vrstvu
    And získaný text obsahuje text obou stran a popis obrázku

  Scenario: Vlastní popis má v knihovně přednost před krátkým popisem
    Given správce nahrál PDF s vlastním popisem
    Then knihovna ukazuje vlastní popis, ne krátký popis od AI

  Scenario: Nepovedené zpracování dokument nezveřejní
    Given zpracování souboru "selhani-cteni.pdf" skončí chybou
    When ho správce nahraje
    Then u souboru vidí, že se zpracování nepodařilo
    And dokument má ve správě stav "Chyba" s důvodem
    And knihovna dokument neukazuje

  Scenario: Zpracování lze zopakovat a ručně zadaný název zůstane
    Given dokument "Kronika obce, rok 1952" má stav "Chyba"
    When správce spustí "Zpracovat znovu"
    Then dokument má stav "Připraveno" a stejný název
    And knihovna dokument ukazuje s krátkým popisem

  Scenario: Kategorii určí AI, když ji správce nevybral
    Given správce nahrál PDF "zapis-rady.pdf" a kategorii nechal na "Určí AI"
    Then dokument je po zpracování v kategorii "Zápisy"

  Scenario: Kategorii vybranou správcem AI nezmění
    Given správce nahrál PDF "zapis-komise.pdf" s kategorií "Smlouvy"
    Then dokument je po zpracování stále v kategorii "Smlouvy"

  Scenario: Dokument, ke kterému AI kategorii nenajde, zůstane nezařazený
    Given správce nahrál PDF "studie-stezky.pdf" a kategorii nechal na "Určí AI"
    Then dokument je po zpracování v kategorii "Nezařazené"

  Scenario: Datum dokumentu určí zpracování a správce ho může opravit
    Given správce nahrál dokument, ve kterém je celé datum 17. 5. 2021
    Then knihovna u dokumentu ukazuje "17. 5. 2021" a řadí ho pod nadpis "květen 2021"
    And filtr roku 2021 dokument najde
    When správce v úpravě dokumentu změní "Datum dokumentu" na 2. 3. 2019
    Then knihovna u dokumentu ukazuje "2. 3. 2019" a řadí ho pod nadpis "březen 2019"

  Scenario: Panel ladění ukáže postup zpracování dokumentu
    Given správce nahrál naskenované PDF "zapis-sken.pdf"
    When v přehledu klikne na řádek dokumentu
    Then pravý panel "Ladění zpracování" ukáže poslední zpracování se stavem "Hotovo"
    And ukáže počet volání modelů, tokeny a cenu
    And ukáže kroky v pořadí: načtení souboru, rozbor stran, volání modelů
    And u každého volání ukáže model, co model dostal, co vrátil a kolik stálo
    And ukáže, co se uložilo do kterého sloupce databáze
    And umí ukázat, co je o dokumentu uložené teď

  Scenario: Nepovedené volání je v panelu ladění i s chybou
    Given zpracování souboru "selhani-cteni.pdf" skončilo chybou
    When správce klikne na řádek dokumentu
    Then panel ladění ukáže zpracování se stavem "Chyba"
    And volání, které selhalo, je označené a ukazuje chybu modelu
    And krok "Uloženo" říká, že dokument má stav "failed"

  Scenario: Popis kategorie je součástí zadání pro model, který kategorii vybírá
    Given správce u kategorie "Zápisy" napsal, co do ní patří
    When nahraje dokument
    Then volání "Určení kategorie" v panelu ladění obsahuje tento popis
