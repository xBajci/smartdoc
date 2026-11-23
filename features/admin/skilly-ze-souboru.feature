Feature: Skilly ze souborů: nahrání do běžící aplikace
  Výchozí skilly jsou soubory v Markdownu v repu. Vývojář upraví soubor a příkazem
  `pnpm skills:push` ho pošle do běžící aplikace. Nový text platí hned, bez nasazení.
  Aplikace text přijme jen s tajným tokenem z proměnné SKILLS_API_TOKEN.
  Předchozí text skillu zůstane v historii.

  Scenario: Aplikace přijme text skillu s platným tokenem
    When vývojář pošle nový text skillu "chat/hledani" s platným tokenem
    Then odpověď říká, že skill je nahraný
    And správce v "Skilly" vidí u "Hledání v archivu" nový text ve verzi 1
    When vývojář pošle stejný text znovu
    Then odpověď říká, že skill je beze změny

  Scenario: Bez platného tokenu aplikace nic nezmění
    When vývojář pošle text skillu bez tokenu
    Then aplikace odpoví "Unauthorized"
    When pošle text skillu se špatným tokenem
    Then aplikace odpoví "Unauthorized"
    And skill "Hledání v archivu" má dál výchozí znění

  Scenario: Aplikace odmítne skill, který není ze souboru
    When vývojář pošle najednou text skillu "chat/hledani" a skillu "vlastni/tykani"
    Then aplikace odpoví chybou
    And skill "Hledání v archivu" má dál výchozí znění

  Scenario: Příkaz pnpm skills:push pošle text ze souboru
    Given skill "chat/hledani" má v aplikaci jiný text než v souboru
    When vývojář spustí "pnpm skills:push chat/hledani"
    Then příkaz vypíše, že skill je nahraný
    And skill "Hledání v archivu" má ve verzi 2 znovu text ze souboru
