Feature: Nahrávání dokumentů
  Správce nahrává z přehledu dokumentů v okně přes stránku.
  Okno soubory jen uloží a samo se zavře.
  Zpracování obsahu potom běží v přehledu dokumentů (viz zpracovani.feature).

  Scenario: Nahrávání nemá vlastní stránku, je to okno nad přehledem
    Given správce je přihlášený
    Then hlavička nemá položku "Nahrávání"
    When v hlavičce zvolí "Zpracování" a v přehledu dokumentů zvolí "Nahrát"
    Then se přes stránku otevře okno "Nahrát dokumenty"
    And vidí podporované formáty a limity
    And tlačítko "Uložit" nejde použít, dokud nevybere soubor

  Scenario: Dávka souborů se uloží, okno se zavře a přehled ukáže zpracování
    Given správce má otevřené okno nahrávání
    When vybere soubory "najem-salu-2023.pdf" a "kostel-z-veze.jpg"
    And u prvního souboru vyplní vlastní popis a kategorii "Smlouvy"
    And rozbalí popis druhého souboru
    Then popis prvního souboru zůstal zachovaný
    When zvolí "Uložit 2 soubory"
    Then okno se samo zavře
    And oba dokumenty jsou v přehledu a skončí stavem "Připraveno"
    And po novém načtení stránky jsou dokumenty stále v přehledu
    And knihovna ukazuje 14 dokumentů
    And první dokument má v knihovně vlastní popis a kategorii "Smlouvy"
    And první dokument má rok vydání 2023 vyčtený z názvu souboru

  Scenario: Během ukládání je vidět průběh
    Given správce vybral soubor a server ho přijímá pomalu
    When zvolí "Uložit 1 soubor"
    Then u souboru vidí "Nahrává se" s ukazatelem průběhu
    And okno nejde zavřít, dokud ukládání běží

  Scenario: Dokument čeká a zpracovává se až v přehledu
    Given zpracování dokumentu trvá déle
    When správce uloží soubor a okno se zavře
    Then dokument je v přehledu se stavem "Zpracovává se"
    When zpracování skončí
    Then dokument má stav "Připraveno"

  Scenario: Nahraný soubor lze otevřít a stáhnout beze změny
    Given správce nahrál soubor "studie-stezky.pdf"
    When ho návštěvník otevře v knihovně
    Then prohlížeč ukazuje jeho strany
    And stažený soubor je bajt po bajtu stejný jako nahraný

  Scenario: Obrázek dostane zmenšený náhled a plná verze se načte až po otevření
    Given správce nahrál obrázek "plan-kopie.png" široký 1600 bodů
    When návštěvník zobrazí knihovnu v režimu "Náhled"
    Then karta ukazuje zmenšený obrázek ve formátu WebP široký 640 bodů
    And prohlížeč si plnou verzi nevyžádal
    When návštěvník obrázek otevře
    Then se načte plná verze široká 1600 bodů

  Scenario: Chyba jednoho souboru neblokuje ostatní a okno zůstane otevřené
    Given správce má otevřené okno nahrávání
    When vybere platné PDF a soubor s příponou PDF, který PDF není
    Then u neplatného souboru vidí "Nepodporovaný formát"
    And tlačítko nabízí uložení 1 souboru
    When zvolí "Uložit 1 soubor"
    Then platný soubor má stav "Uloženo"
    And okno zůstane otevřené s důvodem u neplatného souboru
    When okno zavře
    Then platný dokument je v přehledu a zpracuje se

  Scenario: Stejný soubor se podruhé nezaloží
    Given archiv už obsahuje dokument "Cyklostezka k nádraží, studie první etapy"
    When správce vybere soubor se stejným obsahem
    Then vidí upozornění, že soubor už v archivu je
    And uložení nejde spustit
    And může otevřít existující dokument

  Scenario: Odstraněný dokument zmizí i z úložiště
    Given správce je přihlášený
    When odstraní dokument "Hodový průvod" a potvrdí to
    Then originál ani náhled dokumentu už server nevydá
