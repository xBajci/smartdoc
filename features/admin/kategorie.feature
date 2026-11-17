Feature: Kategorie
  Správce spravuje názvy, popisy, barvy a pořadí kategorií. Seznam je vlevo, vybraná kategorie
  se upravuje vpravo. Stránka vypadá jako stránka Skilly.

  Scenario: Pořadí kategorií se mění přetažením řádku
    Given správce je přihlášený a otevřel Kategorie
    When přetáhne kategorii "Fotografie" před kategorii "Rozpočty"
    Then seznam ukazuje "Fotografie" jako první kategorii
    And po načtení stránky je pořadí stejné
    And knihovna ukazuje štítky kategorií ve stejném pořadí

  Scenario: Řádek jde posunout šipkami, i když není po ruce myš
    Given správce je přihlášený a otevřel Kategorie
    When na úchytu kategorie "Zápisy" stiskne šipku nahoru
    Then kategorie "Zápisy" je o jedno místo výš
    And úchyt kategorie "Zápisy" má dál zaměření
    And stránka oznámí, na kterém místě kategorie je

  Scenario: Nezařazené zůstává poslední a nejde odstranit
    Given správce je přihlášený a otevřel Kategorie
    Then kategorie "Nezařazené" nemá úchyt k přetažení
    When vybere kategorii "Nezařazené"
    Then editor vysvětluje, že tuto kategorii nejde odstranit
    And editor nenabízí odstranění

  Scenario: Změna názvu, popisu a barvy se uloží až tlačítkem
    Given správce je přihlášený a otevřel Kategorie
    When vybere kategorii "Smlouvy" a změní název, popis a barvu
    Then editor ukazuje "Neuložené změny"
    And seznam zatím ukazuje původní název
    When správce změny uloží
    Then seznam ukazuje nový název, popis i barvu
    And po načtení stránky jsou změny stále uložené

  Scenario: Zrušit zahodí neuložené změny
    Given správce je přihlášený a otevřel Kategorie
    When vybere kategorii "Smlouvy" a změní název
    And klikne na "Zrušit"
    Then pole Název ukazuje původní název
    And tlačítko "Uložit změny" je vypnuté

  Scenario: Nová kategorie se přidá z okna a zařadí se před Nezařazené
    Given správce je přihlášený a otevřel Kategorie
    When klikne na "Přidat kategorii" a v okně vyplní název, popis a barvu
    And v okně klikne na "Přidat kategorii"
    Then seznam ukazuje kategorii "Vyhlášky" těsně před kategorií "Nezařazené"
    And editor má otevřenou novou kategorii
