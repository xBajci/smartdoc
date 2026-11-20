Feature: Integrovaný prohlížeč dokumentů
  Dokument se otevírá uvnitř aplikace, ne v nové kartě.

  Scenario: PDF lze stránkovat a zvětšovat
    When návštěvník otevře dokument "Schválený rozpočet na rok 2025"
    Then prohlížeč ukazuje stranu 1 z 3
    When přejde na další stranu
    Then prohlížeč ukazuje stranu 2 z 3
    When přiblíží dokument
    Then se zvětší měřítko
    And je dostupné tlačítko "Stáhnout" s originálním souborem

  Scenario: Text v PDF lze označit a zkopírovat
    When návštěvník otevře dokument "Schválený rozpočet na rok 2025"
    And označí myší větu "Závaznými ukazateli jsou paragrafy rozpočtové skladby."
    Then je tato věta označená
    When ji zkopíruje
    Then schránka obsahuje tuto větu

  Scenario: Označení přes dva řádky nepřeskočí na konec strany
    When návštěvník otevře dokument "Schválený rozpočet na rok 2025"
    And začne označovat řádek a myš přejde do mezery pod ním
    Then označení nesahá za následující řádek
    When dotáhne myš na konec následujícího řádku
    Then jsou označené právě tyto dva řádky

  Scenario: Adresa s číslem strany otevře tuto stranu
    When návštěvník otevře adresu dokumentu "Schválený rozpočet na rok 2025" se stranou 3
    Then prohlížeč ukazuje stranu 3 z 3

  Scenario: Návrat ze zobrazení obnoví hledání, filtry a režim
    Given návštěvník hledá "smlouva" v režimu "Náhled"
    When otevře dokument "Smlouva o nájmu společenského sálu"
    And klikne na "Zpět na seznam"
    Then pole hledání obsahuje "smlouva"
    And je zapnutý režim "Náhled"

  Scenario: Obrázek lze zvětšit a přizpůsobit oknu
    When návštěvník otevře dokument "Plán návsi a přilehlých pozemků"
    And přiblíží dokument
    Then se zobrazí měřítko v procentech
    When zvolí "Přizpůsobit oknu"
    Then je obrázek celý vidět

  Scenario: Zvětšení na celou plochu a návrat
    When návštěvník otevře dokument "Zpravodaj 4/2025"
    And zvolí "Zvětšit"
    Then prohlížeč zabírá celé okno
    When stiskne klávesu Escape
    Then se obnoví předchozí rozložení

  Scenario: Nezveřejněný nebo odstraněný dokument
    When návštěvník otevře adresu dokumentu, který není veřejný
    Then vidí zprávu "Dokument není dostupný"
    And neotevře se jiný dokument

  Scenario: Obrázek se otevře přes stránku, ne v nové kartě
    Given návštěvník vidí seznam dokumentů
    When otevře obrázek "Plán návsi a přilehlých pozemků"
    Then obrázek se ukáže v okně přes stránku
    And prohlížeč neotevřel novou kartu
    When zmáčkne Escape
    Then okno zmizí a seznam je na svém místě
    When obrázek otevře znovu a zvolí "Zavřít"
    Then okno zmizí
