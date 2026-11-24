# SmartDoc Horní Moštěnice

Archiv obecních dokumentů, ve kterém návštěvník hledá a ptá se chatu. Slovník říká, jakým slovem
se co jmenuje ve scénářích, v dokumentaci, v rozhraní a v kódu. V závorce je slovo pro kód.

## Language

### Lidé

**Správce** (administrator):
Člověk, který se přihlásil heslem a smí archiv měnit.
_Avoid_: admin, uživatel

**Návštěvník** (visitor):
Kdokoli bez přihlášení. Vidí jen zveřejněné dokumenty a smí se ptát chatu.
_Avoid_: uživatel, čtenář, reader

**Relace správce** (admin session):
Doba, po kterou prohlížeč správce zůstává přihlášený.
_Avoid_: session bez přívlastku

### Archiv

**Archiv** (archive):
Všechny dokumenty a kategorie, které aplikace drží, zveřejněné i nezveřejněné.

**Knihovna** (library):
Pohled návštěvníka na archiv: jen zveřejněné dokumenty, s hledáním a filtry.
_Avoid_: archiv, když jde jen o veřejnou část

**Dokument** (document):
Jedna položka archivu: jeden soubor a vše, co o něm archiv ví.
_Avoid_: soubor, když jde o položku archivu

**Soubor** (file):
Originál, který správce nahrál, tak jak je v úložišti. Dokument má právě jeden.
_Avoid_: dokument, když jde o bajty

**Náhled** (thumbnail):
Zmenšená kopie obrázku, kterou ukazují seznamy.

**Název** (title):
Jméno dokumentu, které vidí návštěvník. Dá ho název souboru, zpracování, nebo správce.
_Avoid_: jméno, name

**Text dokumentu** (extracted text):
Celý text PDF, nebo odstavec o tom, co je na obrázku. Píše ho zpracování.
_Avoid_: automatický popis, auto description, obsah

**Krátký popis** (short description):
Jedna až dvě věty o dokumentu od zpracování.

**Popis správce** (custom description):
Popis, který napsal správce. Když je vyplněný, knihovna ho ukáže místo krátkého popisu.
_Avoid_: vlastní popis

**Datum vydání** (issued on) a **rok vydání** (issued year):
Den nebo rok, kterým je dokument sám datovaný.
_Avoid_: datum dokumentu, rok

**Přidáno** (added at):
Okamžik, kdy dokument vznikl v archivu. Není to datum vydání.

**Kategorie** (category):
Skupina dokumentů stejného druhu. Dokument má vždy právě jednu.
_Avoid_: štítek, záložka (to jsou prvky rozhraní)

**Nezařazené** (fallback category):
Jediná kategorie, která dostane dokument bez jisté kategorie a dokumenty odstraněné kategorie.
Nejde odstranit.
_Avoid_: výchozí kategorie

**Zveřejněný dokument** (published document):
Dokument, který návštěvník vidí. Je to každý dokument, jehož zpracování skončilo dobře.
_Avoid_: veřejný, publikovaný

### Zpracování

**Zpracování** (processing):
Práce, při které aplikace přečte soubor a zapíše k dokumentu text, název, popis, datum,
kategorii a kousky.
_Avoid_: indexace, import

**Běh zpracování** (processing run):
Jedno zpracování jednoho dokumentu od začátku do konce, s výsledkem „hotovo“ nebo „chyba“.
_Avoid_: session, záznam zpracování

**Stav dokumentu** (document status):
Kde dokument ve zpracování je: čeká na zpracování, zpracovává se, zveřejněno, chyba.
_Avoid_: připraveno

**Kousek** (chunk):
Část textu dokumentu, ve které chat hledá.
_Avoid_: úryvek, pasáž, piece

### Modely a skilly

**Volání modelu** (model call):
Jeden dotaz na model AI a jeho odpověď.

**Záznam volání** (call record):
Co se o jednom volání modelu uložilo: co dostal, co vrátil, skilly, doba, tokeny a cena.

**Rozhodovací model** (decision model):
Model, který na otázku vrátí pravděpodobnosti, ne text. Vybírá kategorii, váhy hledání a
hodnotí úryvky.
_Avoid_: Jev, když jde o roli a ne o dodavatele

**Skill** (skill):
Text v Markdownu, podle kterého model dělá jednu část práce.
_Avoid_: prompt, instrukce

**Výchozí skill** (starting skill):
Skill, který je součástí aplikace. Správce smí změnit jeho text a místa a vrátit ho zpět.
_Avoid_: vestavěný skill, built-in

**Vlastní skill** (custom skill):
Skill, který přidal správce. Jen takový jde přejmenovat, vypnout a odstranit.

**Verze skillu** (skill version):
Jedno uložené znění skillu. Verze 0 je znění z aplikace.

**Místo** (skill use):
Bod v aplikaci, kde se volá model a kam se skilly připojují.
_Avoid_: použití, operace

**Skupina skillů** (skill group):
Zpracování, nebo chat. Skill patří do jedné a smí se připojit jen na její místa.

**Systémový prompt** (system prompt):
Text, který dostane každé volání skupiny, které odpovídá vlastními slovy.

**Glosář** (glossary):
Skill chatu, který říká, o čem dokumenty archivu jsou a jakými slovy úřad píše.
_Avoid_: slovník (to je tento soubor)

**Náklady** (costs):
Cena volání modelů v amerických dolarech, sečtená podle modelu a typu souboru.

### Chat

**Otázka** (question):
Jedno zeptání návštěvníka nebo správce a cesta k odpovědi na něj.
_Avoid_: dotaz, zpráva

**Zkušební otázka** (test question):
Otázka, kterou položí správce v ladění. Nepočítá se do limitů návštěvníků.

**Rozhovor** (conversation):
Otázky a odpovědi, které na sebe navazují, dokud návštěvník nezvolí „Nový chat“.
_Avoid_: konverzace, relace, session

**Shrnutí rozhovoru** (conversation summary):
Text, který modelu nahradí dřívější otázky, když rozhovor příliš naroste.

**Rozsah odpovědi** (scope):
Z čeho smí odpověď čerpat: z celého archivu, nebo jen z vybraných dokumentů.

**Výběr** (chosen documents):
Dokumenty, na které návštěvník omezil rozsah odpovědi.

**Dotaz** (query):
Slova, která se pošlou do hledání chatu. Píše je model, ne návštěvník.
_Avoid_: otázka

**Hledání chatu** (chat search):
Hledání kousků pro jeden dotaz. Má větev slov a větev významu a jejich pořadí spojí.
_Avoid_: hledání bez přívlastku, retrieval

**Hledání v knihovně** (library search):
Hledání dokumentů podle slov, která napsal návštěvník nebo správce.
_Avoid_: hledání bez přívlastku

**Nalezené místo** (snippet):
Pár slov z textu dokumentu kolem hledaných slov, které seznam ukáže po „V textu:“.
_Avoid_: úryvek (to je kousek pro model chatu)

**Úryvek** (passage):
Kousek, který hledání chatu vybralo pro model, s číslem, kterým ho model cituje.
_Avoid_: kousek, pasáž

**Citace** (citation):
Značka v odpovědi, která ukazuje na číslo úryvku.

**Zdroj** (source):
Místo v dokumentu, o které se odpověď opírá: dokument a strana. Vidí ho návštěvník.
_Avoid_: citace, úryvek

**Výpočet** (calculation):
Skript, který model napíše, aby spočítal čísla z úryvků.

**Hodnocení odpovědi** (answer rating):
Slovo návštěvníka, jestli mu odpověď pomohla, nebo nepomohla.
_Avoid_: feedback, zpětná vazba

**Záznam otázky** (trace):
Vše, co se u jedné otázky stalo, uložené pro správce: volání modelů, hledání, úryvky a odpověď.
_Avoid_: stopa, log

**Ladění** (debugging):
Místo ve správě, kde správce čte záznamy otázek a běhy zpracování.
