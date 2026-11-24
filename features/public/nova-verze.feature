Feature: Stránka po chybě a po nasazení nové verze
  Kdo má web otevřený, když se nasadí nová verze, má v kartě ještě tu starou. Nový server jí
  neodpoví. Stránka se proto sama načte znovu, místo aby ukázala chybu. Totéž udělá při jiné
  chybě stránky. Zprávu s tlačítkem ukáže, jen když chyba trvá i po novém načtení.

  Scenario: Běžné procházení stránku znovu nenačítá
    Given návštěvník má otevřenou knihovnu
    When hledá "rozpočet" a otevře přihlášení
    Then stránka se znovu nenačetla
    And prohlížeč se serveru na verzi neptal

  Scenario: Karta se starou verzí se po nasazení sama načte znovu
    Given návštěvník má otevřenou knihovnu
    And mezitím byla nasazena nová verze, která staré kartě neodpovídá
    When hledá "rozpočet"
    Then stránka se sama načte znovu
    And knihovna ukazuje výsledky hledání "rozpočet" a žádnou chybu

  Scenario: Otázka do chatu ze staré karty načte stránku znovu
    Given návštěvník má otevřenou knihovnu
    And mezitím byla nasazena nová verze, která staré kartě neodpovídá
    When se v chatu zeptá "Kdo vymění veřejné osvětlení?"
    Then stránka se sama načte znovu
    And chat žádnou chybu neukáže a čeká na otázku

  Scenario: Chyba chatu ve stejné verzi stránku znovu nenačítá
    Given návštěvník má otevřenou knihovnu
    And server jednou neodpoví
    When se v chatu zeptá "Kdo vymění veřejné osvětlení?"
    Then chat píše "Odpověď se nepodařilo získat."
    And stránka se znovu nenačetla

  Scenario: Chyba stránky ji načte znovu, místo aby se ukázala
    Given návštěvník má otevřenou knihovnu
    And server jednou neodpoví
    When hledá "rozpočet"
    Then stránka se sama načte znovu
    And knihovna ukazuje výsledky hledání "rozpočet" a žádnou chybu

  Scenario: Když chyba trvá i po novém načtení, stránka to řekne a nabídne další pokus
    Given návštěvník má otevřenou knihovnu
    And server přestal odpovídat
    When hledá "rozpočet"
    Then stránka se načte znovu jen jednou
    And ukáže zprávu "Archiv se nepodařilo načíst" s tlačítkem "Načíst znovu"
    When server znovu odpovídá a návštěvník zvolí "Načíst znovu"
    Then knihovna ukazuje výsledky hledání "rozpočet" a žádnou chybu
