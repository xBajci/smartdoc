Feature: RSS s novými dokumenty
  Kdo chce vědět o novém dokumentu, přidá si adresu /rss.xml do čtečky.
  Každý zveřejněný dokument je v RSS jeden záznam, nejnověji přidaný první.

  Scenario: RSS obsahuje zveřejněné dokumenty od nejnověji přidaného
    When čtečka požádá o "/rss.xml"
    Then dostane RSS 2.0 s 12 záznamy
    And první záznam je "Zápis z 9. zasedání zastupitelstva" s odkazem na dokument v knihovně
    And každý záznam má název, popis, kategorii a datum přidání
    And nezveřejněný dokument "Zpravodaj 3/2025" v RSS není

  Scenario: Odkazy v RSS vedou na veřejnou adresu webu
    Given web má nastavenou veřejnou adresu "https://archiv.example.cz"
    When čtečka požádá o "/rss.xml" na jiné adrese serveru
    Then odkaz na web, adresa RSS i odkazy záznamů začínají "https://archiv.example.cz/"

  Scenario: Nově nahraný dokument se v RSS objeví jako první
    Given správce nahrál dokument a zpracování skončilo dobře
    When čtečka požádá o "/rss.xml" znovu
    Then první záznam je nový dokument

  Scenario: Stránka na RSS odkazuje
    When návštěvník otevře knihovnu
    Then hlavička stránky nabízí čtečkám adresu "/rss.xml"
    And v hlavičce vedle účtu je ikona RSS s odkazem na "/rss.xml"
