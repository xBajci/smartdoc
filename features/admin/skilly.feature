Feature: Skilly: systémový prompt, úpravy a vlastní skilly
  Skill je text v Markdownu, podle kterého model pracuje.
  Skilly jsou ve dvou skupinách: zpracování dokumentů a obrázků, a chat.
  Každá skupina má jeden systémový prompt. Systém ke každému volání sám přiloží
  systémový prompt skupiny a skilly, které k tomu místu patří.
  Správce skilly upravuje a přidává vlastní.

  Scenario: Vlevo je seznam skillů ve dvou skupinách, vpravo jeden skill k úpravě
    Given správce je přihlášený
    When otevře "Skilly"
    Then vlevo vidí skupiny "Zpracování dokumentů a obrázků" a "Chat"
    And první řádek každé skupiny je její systémový prompt
    And vpravo je otevřený první skill "Čtení strany" a jeho řádek je zvýrazněný
    When v seznamu zvolí "Datum a rok dokumentu"
    Then vpravo vidí jeho text v Markdownu a zaškrtnutá místa, kde se použije
    And systémový prompt žádná místa k zaškrtnutí nemá
    And skupina "Chat" má skill "Glosář archivu" se zkratkami úřadu, zaškrtnutý pro "Odpověď v chatu"
    And stránka nemá žádné vyhodnocení ani návrhy úprav od modelu

  Scenario: Správce upraví skill a další zpracování ho dostane
    When správce u skillu "Čtení strany" změní text
    Then vidí "Neuložené změny" a "Zrušit" vrátí uložený text
    When změní text znovu a zvolí "Uložit změny"
    Then skill má verzi 1 s novým textem
    When nahraje naskenované PDF
    Then volání "Čtení naskenované strany" v panelu ladění dostalo systémový prompt a upravený skill ve verzi 1
    When správce zvolí "Vrátit výchozí znění"
    Then skill má znovu výchozí znění

  Scenario: Správce změní, kde se skill použije
    When správce u skillu "Čtení strany" odškrtne místo "Čtení naskenované strany" a uloží změny
    Then volání "Čtení naskenované strany" tento skill už nedostane
    And skill bez jediného místa uložit nejde
    When správce zvolí "Vrátit výchozí znění"
    Then skill má znovu obě výchozí místa

  Scenario: Správce přidá vlastní skill a systém ho přiloží tam, kde má být
    When správce zvolí "Přidat skill"
    Then okno má vybranou skupinu otevřeného skillu a nabízí jen její místa
    When vyplní název "Názvy zápisů", zaškrtne "Popis dokumentu" a napíše text
    Then skill je v seznamu, je otevřený a má klíč "vlastni/nazvy-zapisu"
    When nahraje naskenované PDF
    Then volání pro popis dokumentu skill dostalo
    And volání pro čtení strany ho nedostalo

  Scenario: Vlastní skill lze přejmenovat, vypnout a odstranit
    Given správce přidal do skupiny chat skill "Tykání"
    When změní název na "Vykání" a uloží změny
    Then seznam ukazuje "Vykání"
    When zvolí "Vypnout"
    Then řádek skillu je označený "Vypnutý"
    When zvolí "Odstranit" a potvrdí
    Then skill zmizí
    And skilly systému tlačítka "Vypnout" a "Odstranit" nemají

  Scenario: Chat dostane systémový prompt a skilly chatu
    Given správce upravil skill "Odpověď a citace"
    When v "Ladění chatu" položí zkušební otázku
    Then záznam otázky ukazuje systémový prompt chatu, skill "Hledání v archivu" a upravený text
