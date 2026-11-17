Feature: Náklady na zpracování
  Správce vidí, kolik stálo čtení dokumentů pomocí AI.
  Náklady jsou rozdělené podle modelu a podle typu souboru.

  Scenario: Bez zpracování stránka říká, že není co ukázat
    Given správce je přihlášený a nic se zatím nezpracovalo
    When otevře "Náklady"
    Then vidí "Zatím se nezpracoval žádný dokument."

  Scenario: Náklady jsou rozdělené podle modelu a typu souboru
    Given správce nahrál obrázek a naskenované PDF
    Then u každého z nich v přehledu dokumentů vidí modely, které ho zpracovaly, a cenu
    When otevře "Náklady"
    Then vidí celkovou cenu a počet zpracování
    And vidí řádek pro každou dvojici modelu a typu souboru s počtem volání, tokeny a cenou
    And v posledních zpracováních vidí oba dokumenty s jejich cenou

  Scenario: Náklady zůstanou i po odstranění dokumentu
    Given správce nahrál obrázek a potom ho odstranil
    When otevře "Náklady"
    Then zpracování odstraněného dokumentu je stále v přehledu

  Scenario: Návštěvník náklady nedostane
    Given návštěvník není přihlášený
    When otevře adresu nákladů
    Then vidí jen přihlašovací formulář
