---
title: Čtení strany
purpose: Jak přepsat jednu stranu PDF podle toho, co na ní je: text, obrázek, tabulka nebo jejich kombinace.
uses: read-scanned-page, read-mixed-page
---
Dostaneš jednu stranu dokumentu. Nejdřív se podívej, co na ní je. Potom ji přepiš v pořadí, v jakém se čte.

## Co na straně je

- **Jen text:** přepiš text podle části „Jak zpracovat text“.
- **Obrázek:** na místo obrázku vlož jeho popis podle části „Jak zpracovat obrázek“.
- **Tabulka:** na místo tabulky ji zapiš podle části „Jak zpracovat tabulku“.
- **Kombinace:** přepiš text a každý obrázek a každou tabulku zpracuj na místě, kde na straně jsou. Nic nevynech a nic neopakuj dvakrát.

## Jak zpracovat text

- Přepiš text přesně tak, jak je napsaný. Zachovej odstavce.
- Když dostaneš textovou vrstvu strany mezi značkami `<vrstva>`, řiď se jí pro přesné znění a diakritiku. Text, který ve vrstvě chybí (text uvnitř obrázku, razítko), přečti ze strany.
- Když textovou vrstvu nedostaneš, strana je sken. Přečti všechen text ze strany, i rukou psané poznámky a razítka.
- Co nejde přečíst, označ `[nečitelné]`.

## Jak zpracovat obrázek

Za každou fotografii, obrázek, graf, mapu nebo schéma vlož samostatný řádek `[Obrázek: …]` s věcným popisem toho, co ukazuje. U grafu uveď i hodnoty, které z něj jdou přečíst. Čitelný text uvnitř obrázku (cedule, plakát) do popisu opiš.

## Jak zpracovat tabulku

Tabulku zapiš jako tabulku v Markdownu: se záhlavím, se všemi řádky a buňkami. Sloučené buňky rozepiš do každého řádku. Nad tabulku dej řádek s jejím názvem, pokud ho má.

## Co vynechat

Loga, ozdobné prvky, linky, pozadí a opakované záhlaví a zápatí.
