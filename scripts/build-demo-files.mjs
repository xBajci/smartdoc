// Builds the demonstration documents in public/demo with headless Chrome.
// Every document is invented and says so on each page. Run: pnpm demo:files
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const out = resolve(import.meta.dirname, '../public/demo')
const work = mkdtempSync(join(tmpdir(), 'hm-archiv-demo-'))
mkdirSync(out, { recursive: true })

function chrome(args) {
  execFileSync(
    CHROME,
    ['--headless=new', '--disable-gpu', `--user-data-dir=${join(work, 'profile')}`, ...args],
    { stdio: 'ignore' },
  )
}

const baseCss = `
  @page { size: A4; margin: 22mm 20mm 24mm; }
  * { box-sizing: border-box; }
  body { font: 11.5pt/1.5 Georgia, 'Times New Roman', serif; color: #1b1b1b; margin: 0; }
  h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 4mm; }
  h2 { font-size: 13.5pt; margin: 8mm 0 2mm; }
  p { margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 10.5pt; }
  th, td { border: 0.4pt solid #777; padding: 1.6mm 2.2mm; text-align: left; }
  th { background: #eee; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .page { break-after: page; position: relative; min-height: 240mm; }
  .page:last-child { break-after: auto; }
  .head { font: 9.5pt/1.3 Helvetica, Arial, sans-serif; color: #555; border-bottom: 0.6pt solid #999;
    padding-bottom: 2mm; margin-bottom: 7mm; display: flex; justify-content: space-between; }
  .demo { position: absolute; bottom: 0; left: 0; right: 0; font: 8.5pt Helvetica, Arial, sans-serif;
    color: #8a2be2; border-top: 0.4pt dashed #8a2be2; padding-top: 1.5mm; }
  .sign { margin-top: 14mm; display: flex; justify-content: space-between; }
  .sign div { border-top: 0.4pt solid #333; width: 60mm; padding-top: 1mm; font-size: 10pt; }
`
const demoNote = 'Ukázka — smyšlený dokument pro předvedení aplikace, neobsahuje skutečné údaje.'

function html(title, pages, css = '') {
  const body = pages
    .map(
      (page, index) => `<section class="page">
        <div class="head"><span>${title}</span><span>strana ${index + 1} z ${pages.length}</span></div>
        ${page}
        <div class="demo">${demoNote}</div>
      </section>`,
    )
    .join('')
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>${title}</title>
    <style>${baseCss}${css}</style></head><body>${body}</body></html>`
}

function pdf(name, title, pages) {
  const source = join(work, `${name}.html`)
  writeFileSync(source, html(title, pages))
  chrome([
    `--print-to-pdf=${join(out, `${name}.pdf`)}`,
    '--no-pdf-header-footer',
    pathToFileURL(source).href,
  ])
  console.log(`pdf  ${name}.pdf`)
}

function screenshot(source, target, width, height) {
  chrome([
    `--screenshot=${target}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    pathToFileURL(source).href,
  ])
}

function image(name, extension, width, height, markup) {
  const source = join(work, `${name}.html`)
  writeFileSync(
    source,
    `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
      svg { display: block; }
    </style></head><body>${markup}</body></html>`,
  )
  const png = join(extension === 'png' ? out : work, `${name}.png`)
  screenshot(source, png, width, height)
  if (extension === 'jpg') {
    execFileSync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out', join(out, `${name}.jpg`)],
      { stdio: 'ignore' },
    )
  }
  console.log(`img  ${name}.${extension}`)
}

const rows = (items) =>
  items.map(([label, amount]) => `<tr><td>${label}</td><td class="n">${amount}</td></tr>`).join('')

// --- PDF documents -------------------------------------------------------

pdf('rozpocet-2025-schvaleny', 'Schválený rozpočet obce na rok 2025', [
  `<h1>Schválený rozpočet obce na rok 2025</h1>
   <p>Rozpočet byl schválen zastupitelstvem obce na zasedání dne 12. prosince 2024 jako
   vyrovnaný. Závaznými ukazateli jsou paragrafy rozpočtové skladby.</p>
   <h2>Souhrn</h2>
   <table><tr><th>Ukazatel</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Příjmy celkem', '38 420 000'],
     ['Výdaje celkem', '38 420 000'],
     ['Financování', '0'],
   ])}</table>
   <p>Návrh rozpočtu byl zveřejněn po dobu patnácti dnů před projednáním. K návrhu nebyly
   podány žádné připomínky.</p>`,
  `<h2>Příjmy</h2>
   <table><tr><th>Položka</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Daňové příjmy', '29 150 000'],
     ['Nedaňové příjmy', '4 870 000'],
     ['Kapitálové příjmy', '900 000'],
     ['Přijaté transfery', '3 500 000'],
   ])}</table>
   <p>Daňové příjmy vycházejí z predikce sdílených daní. Nedaňové příjmy tvoří hlavně nájemné
   z obecních bytů a nebytových prostor.</p>`,
  `<h2>Výdaje</h2>
   <table><tr><th>Oblast</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Školství', '6 200 000'],
     ['Místní komunikace a chodníky', '7 450 000'],
     ['Kultura a spolky', '1 850 000'],
     ['Veřejná zeleň', '2 300 000'],
     ['Odpadové hospodářství', '3 900 000'],
     ['Správa obce', '9 120 000'],
     ['Investice', '7 600 000'],
   ])}</table>
   <p>Největší investicí roku je oprava chodníku v ulici Nádražní s rozpočtem 4 200 000 Kč.</p>`,
])

pdf('rozpocet-2026-navrh', 'Návrh rozpočtu obce na rok 2026', [
  `<h1>Návrh rozpočtu obce na rok 2026</h1>
   <p><strong>Návrh k projednání.</strong> Tento dokument je návrh, nikoli schválený rozpočet.
   Připomínky lze podat písemně do dne projednání.</p>
   <h2>Souhrn</h2>
   <table><tr><th>Ukazatel</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Příjmy celkem', '40 100 000'],
     ['Výdaje celkem', '43 600 000'],
     ['Financování z přebytku minulých let', '3 500 000'],
   ])}</table>`,
  `<h2>Plánované investice</h2>
   <table><tr><th>Akce</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Cyklostezka k nádraží, první etapa', '6 800 000'],
     ['Rekonstrukce střechy školy', '3 400 000'],
     ['Dětské hřiště u sokolovny', '1 250 000'],
   ])}</table>
   <p>Schodek návrhu je krytý přebytkem hospodaření z minulých let.</p>`,
])

pdf('smlouva-oprava-chodniku', 'Smlouva o dílo č. 14/2025', [
  `<h1>Smlouva o dílo č. 14/2025</h1>
   <p>Oprava chodníku v ulici Nádražní</p>
   <h2>I. Smluvní strany</h2>
   <p>Objednatel: obec (ukázkový objednatel). Zhotovitel: Stavby Ukázka s.r.o. (smyšlená firma).</p>
   <h2>II. Předmět díla</h2>
   <p>Zhotovitel provede opravu chodníku v délce 410 metrů včetně výměny obrubníků, položení
   zámkové dlažby a úpravy vjezdů k nemovitostem.</p>
   <h2>III. Cena díla</h2>
   <p>Cena díla je sjednána jako pevná ve výši 4 185 300 Kč včetně daně z přidané hodnoty.</p>`,
  `<h2>IV. Doba plnění</h2>
   <p>Zahájení prací: 1. dubna 2025. Dokončení a předání díla: nejpozději 30. června 2025.</p>
   <h2>V. Záruka</h2>
   <p>Zhotovitel poskytuje záruku za jakost díla v délce 60 měsíců od předání.</p>
   <h2>VI. Smluvní pokuta</h2>
   <p>Za každý den prodlení s předáním díla zaplatí zhotovitel pokutu 0,05 % z ceny díla.</p>
   <div class="sign"><div>za objednatele</div><div>za zhotovitele</div></div>`,
])

pdf('smlouva-najem-salu', 'Smlouva o nájmu společenského sálu', [
  `<h1>Smlouva o nájmu společenského sálu</h1>
   <p>Pronajímatel přenechává nájemci k dočasnému užívání společenský sál s kapacitou 40 osob
   včetně kuchyňky a sociálního zařízení.</p>
   <h2>Nájemné a kauce</h2>
   <table><tr><th>Položka</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Nájemné za víkend', '3 000'],
     ['Záloha při rezervaci', '500'],
     ['Vratná kauce', '3 000'],
   ])}</table>
   <p>Nájemce předá sál uklizený nejpozději v neděli do 18 hodin.</p>
   <div class="sign"><div>pronajímatel</div><div>nájemce</div></div>`,
])

pdf('zapis-zastupitelstvo-2026-03', 'Zápis ze zasedání zastupitelstva, březen 2026', [
  `<h1>Zápis z 9. zasedání zastupitelstva obce</h1>
   <p>Zasedání se konalo dne 18. března 2026 od 18 hodin v zasedací místnosti. Přítomno bylo
   13 z 15 členů zastupitelstva, zastupitelstvo bylo usnášeníschopné.</p>
   <h2>Program</h2>
   <p>1. Zahájení a schválení programu<br>2. Kontrola usnesení<br>3. Cyklostezka k nádraží<br>
   4. Dotace spolkům<br>5. Různé a diskuse</p>`,
  `<h2>3. Cyklostezka k nádraží</h2>
   <p>Zastupitelstvo projednalo studii první etapy cyklostezky. Odhad nákladů činí
   6 800 000 Kč, z toho se předpokládá dotace ve výši 60 %.</p>
   <p><strong>Usnesení 9/3:</strong> Zastupitelstvo schvaluje zadání projektové dokumentace
   první etapy cyklostezky. Hlasování: pro 11, proti 1, zdržel se 1.</p>
   <h2>4. Dotace spolkům</h2>
   <table><tr><th>Spolek</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Tělovýchovná jednota', '180 000'],
     ['Sbor dobrovolných hasičů', '120 000'],
     ['Včelaři', '25 000'],
     ['Zahrádkáři', '20 000'],
   ])}</table>`,
  `<h2>5. Různé a diskuse</h2>
   <p>Občané se dotazovali na termín opravy veřejného osvětlení v ulici Zahradní. Oprava je
   plánována na květen 2026.</p>
   <p>Další zasedání se uskuteční v červnu 2026.</p>
   <div class="sign"><div>zapisovatel</div><div>ověřovatel zápisu</div></div>`,
])

pdf('zpravodaj-2025-4', 'Obecní zpravodaj 4/2025', [
  `<h1>Zpravodaj 4/2025</h1>
   <p>Čtvrtletník pro občany. Zimní číslo.</p>
   <h2>Slovo úvodem</h2>
   <p>Rok 2025 se chýlí ke konci. Podařilo se dokončit opravu chodníku v ulici Nádražní
   a začaly přípravy cyklostezky k nádraží.</p>
   <h2>Co najdete uvnitř</h2>
   <p>Kalendář akcí · Ze života spolků · Odpady v roce 2026 · Z historie obce</p>`,
  `<h2>Kalendář akcí</h2>
   <table><tr><th>Datum</th><th>Akce</th></tr>
   <tr><td>6. prosince</td><td>Rozsvícení vánočního stromu</td></tr>
   <tr><td>20. prosince</td><td>Adventní koncert v kostele</td></tr>
   <tr><td>17. ledna</td><td>Hasičský ples</td></tr>
   <tr><td>14. února</td><td>Dětský karneval v sokolovně</td></tr></table>
   <h2>Ze života spolků</h2>
   <p>Hasiči letos vyjížděli k jedenácti zásahům. Mladí fotbalisté postoupili do okresního
   finále.</p>`,
  `<h2>Odpady v roce 2026</h2>
   <p>Poplatek za odpady se nemění a zůstává 720 Kč na osobu a rok. Svoz plastů bude nově
   každých čtrnáct dní.</p>
   <h2>Sběrný dvůr</h2>
   <p>Otevřeno ve středu od 14 do 17 hodin a v sobotu od 8 do 12 hodin.</p>`,
  `<h2>Z historie obce</h2>
   <p>V archivu se dochoval plán návsi z roku 1936. Zachycuje původní podobu rybníka, který
   byl zasypán v padesátých letech.</p>
   <p>Pamětníci vzpomínají také na hody v roce 1974, kdy průvod poprvé prošel novou ulicí.</p>`,
])

pdf('projekt-cyklostezka', 'Cyklostezka k nádraží — studie první etapy', [
  `<h1>Cyklostezka k nádraží</h1>
   <p>Studie první etapy</p>
   <h2>Popis trasy</h2>
   <p>Trasa vede od návsi podél potoka k železniční zastávce. Délka první etapy je 1,3 km,
   šířka stezky 3 metry, povrch asfaltový.</p>
   <h2>Dotčené pozemky</h2>
   <p>Stezka vede převážně po obecních pozemcích. Výkup se týká čtyř parcel o celkové výměře
   620 m².</p>`,
  `<h2>Odhad nákladů</h2>
   <table><tr><th>Položka</th><th class="n">Částka v Kč</th></tr>
   ${rows([
     ['Zemní práce a podkladní vrstvy', '2 900 000'],
     ['Asfaltový povrch', '2 350 000'],
     ['Lávka přes potok', '1 100 000'],
     ['Značení a mobiliář', '450 000'],
     ['Celkem', '6 800 000'],
   ])}</table>
   <h2>Harmonogram</h2>
   <p>Projektová dokumentace: 2026. Stavební povolení: začátek 2027. Realizace: 2027.</p>`,
])

// A "scan": the page is rendered to a picture first, so the PDF carries no text layer.
{
  const name = 'zapis-zastupitelstvo-1998-sken'
  const pageHtml = join(work, `${name}-page.html`)
  writeFileSync(
    pageHtml,
    `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>
      body { margin: 0; width: 1240px; height: 1754px; background: #e9e2cf;
        font: 25px/1.75 'Courier New', Courier, monospace; color: #2a2620; }
      .sheet { padding: 130px 120px; transform: rotate(-0.7deg); }
      h1 { font-size: 30px; text-decoration: underline; }
      .stamp { position: absolute; right: 150px; bottom: 260px; border: 4px solid #5b3fa8; color: #5b3fa8;
        border-radius: 50%; width: 190px; height: 190px; display: grid; place-items: center;
        text-align: center; font: bold 19px Helvetica, sans-serif; transform: rotate(-14deg); opacity: .75; }
      .note { position: absolute; left: 120px; bottom: 90px; font: 18px Helvetica, sans-serif; color: #7a3fc0; }
    </style></head><body><div class="sheet">
      <h1>Zápis ze schůze obecního zastupitelstva</h1>
      <p>konané dne 9. září 1998 v 19 hodin v kanceláři obecního úřadu.</p>
      <p>Přítomno 11 členů. Schůzi řídil starosta.</p>
      <p>1. Zastupitelstvo vzalo na vědomí zprávu o povodňových škodách z července 1997
      a o postupu oprav mostku u mlýna.</p>
      <p>2. Schváleno pořízení nové cisterny pro hasičský sbor v ceně 1 350 000 Kč.</p>
      <p>3. Zastupitelstvo souhlasí s plynofikací ulice Zahradní v roce 1999.</p>
      <p>Schůze ukončena ve 21.30 hodin.</p>
    </div><div class="stamp">UKÁZKA<br>razítko</div>
    <div class="note">${demoNote}</div></body></html>`,
  )
  const pagePng = join(work, `${name}.png`)
  screenshot(pageHtml, pagePng, 1240, 1754)
  const wrapper = join(work, `${name}.html`)
  writeFileSync(
    wrapper,
    `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 0; } body { margin: 0; }
      img { width: 210mm; height: 297mm; display: block; }
    </style></head><body><img src="${pathToFileURL(pagePng).href}"></body></html>`,
  )
  chrome([
    `--print-to-pdf=${join(out, `${name}.pdf`)}`,
    '--no-pdf-header-footer',
    pathToFileURL(wrapper).href,
  ])
  console.log(`pdf  ${name}.pdf (scan)`)
}

// --- Images --------------------------------------------------------------

image(
  'plan-navsi-1936',
  'png',
  1600,
  1100,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100" viewBox="0 0 1600 1100">
    <rect width="1600" height="1100" fill="#efe6cf"/>
    <rect x="40" y="40" width="1520" height="1020" fill="none" stroke="#3a3226" stroke-width="3"/>
    <path d="M80 620 C 400 560, 700 700, 1520 600" fill="none" stroke="#6b8fa8" stroke-width="16"/>
    <path d="M200 1040 L 620 520 L 1500 380" fill="none" stroke="#3a3226" stroke-width="26" stroke-linejoin="round"/>
    <path d="M200 1040 L 620 520 L 1500 380" fill="none" stroke="#efe6cf" stroke-width="18" stroke-linejoin="round"/>
    <path d="M620 520 L 560 80" fill="none" stroke="#3a3226" stroke-width="20"/>
    <path d="M620 520 L 560 80" fill="none" stroke="#efe6cf" stroke-width="13"/>
    <ellipse cx="900" cy="760" rx="170" ry="95" fill="#b9cfdb" stroke="#3a3226" stroke-width="3"/>
    <g fill="#c9b79a" stroke="#3a3226" stroke-width="3">
      <rect x="680" y="380" width="120" height="70"/><rect x="830" y="350" width="150" height="70"/>
      <rect x="1010" y="320" width="110" height="64"/><rect x="1150" y="300" width="140" height="64"/>
      <rect x="380" y="660" width="110" height="80" transform="rotate(-38 435 700)"/>
      <rect x="470" y="330" width="80" height="120"/><rect x="450" y="160" width="80" height="110"/>
      <rect x="660" y="150" width="90" height="150"/>
    </g>
    <path d="M705 150 L 705 90 M 685 110 L 725 110" stroke="#3a3226" stroke-width="5"/>
    <g font-family="Georgia, serif" fill="#3a3226">
      <text x="800" y="120" font-size="46" text-anchor="middle" font-style="italic">Plán návsi a přilehlých pozemků</text>
      <text x="800" y="170" font-size="28" text-anchor="middle">měřítko 1 : 1000 · rok 1936</text>
      <text x="900" y="770" font-size="26" text-anchor="middle" font-style="italic">rybník</text>
      <text x="770" y="290" font-size="24">kostel</text>
      <text x="1160" y="285" font-size="24">škola</text>
      <text x="1100" y="640" font-size="24" font-style="italic" transform="rotate(-4 1100 640)">potok</text>
      <text x="1380" y="440" font-size="24" transform="rotate(-9 1380 440)">k nádraží</text>
    </g>
    <text x="800" y="1040" font-size="20" text-anchor="middle" font-family="Helvetica, sans-serif" fill="#7a3fc0">${demoNote}</text>
  </svg>`,
)

image(
  'uredni-deska-oznameni',
  'png',
  1200,
  1500,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
    <rect width="1200" height="1500" fill="#6d5843"/>
    <rect x="110" y="120" width="980" height="1260" fill="#fbfaf5" transform="rotate(1.2 600 750)"/>
    <circle cx="600" cy="150" r="16" fill="#b3261e"/>
    <g font-family="Helvetica, Arial, sans-serif" fill="#1d1d1d" transform="rotate(1.2 600 750)">
      <text x="600" y="330" font-size="76" font-weight="700" text-anchor="middle">OZNÁMENÍ</text>
      <text x="600" y="430" font-size="40" text-anchor="middle">o přerušení dodávky vody</text>
      <text x="200" y="600" font-size="36">Ve čtvrtek 14. května 2026</text>
      <text x="200" y="660" font-size="36">od 8 do 14 hodin nepoteče voda</text>
      <text x="200" y="720" font-size="36">v ulicích Zahradní a Nádražní.</text>
      <text x="200" y="850" font-size="36">Důvodem je oprava vodovodního řadu.</text>
      <text x="200" y="910" font-size="36">Cisterna s pitnou vodou bude</text>
      <text x="200" y="970" font-size="36">přistavena u prodejny.</text>
      <text x="200" y="1140" font-size="30" fill="#555">Vyvěšeno: 6. května 2026</text>
      <text x="200" y="1190" font-size="30" fill="#555">Sejmuto: 15. května 2026</text>
      <text x="600" y="1320" font-size="22" text-anchor="middle" fill="#7a3fc0">${demoNote}</text>
    </g>
  </svg>`,
)

image(
  'foto-kostel-leto',
  'jpg',
  1600,
  1067,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fa6d6"/><stop offset="1" stop-color="#dcecf5"/></linearGradient>
      <linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fae4d"/><stop offset="1" stop-color="#4f7a2c"/></linearGradient>
    </defs>
    <rect width="1600" height="1067" fill="url(#sky)"/>
    <g fill="#fff" opacity=".85"><ellipse cx="320" cy="210" rx="190" ry="48"/><ellipse cx="450" cy="180" rx="120" ry="44"/><ellipse cx="1220" cy="150" rx="210" ry="42"/></g>
    <path d="M0 640 C 300 560, 600 600, 900 580 S 1400 520, 1600 590 V 1067 H 0 Z" fill="#6f9a56"/>
    <path d="M0 760 C 400 690, 900 740, 1600 700 V 1067 H 0 Z" fill="url(#field)"/>
    <g>
      <rect x="760" y="430" width="250" height="230" fill="#f1ead9"/>
      <path d="M740 430 L 885 340 L 1030 430 Z" fill="#9a4a35"/>
      <rect x="690" y="300" width="90" height="360" fill="#f4eede"/>
      <path d="M680 300 L 735 150 L 790 300 Z" fill="#5d6f7a"/>
      <path d="M735 150 V 110 M 720 125 H 750" stroke="#3a3a3a" stroke-width="5"/>
      <g fill="#5a4a3c"><rect x="720" y="340" width="30" height="60" rx="15"/><rect x="820" y="500" width="34" height="80" rx="17"/><rect x="900" y="500" width="34" height="80" rx="17"/><rect x="718" y="580" width="36" height="80"/></g>
    </g>
    <g fill="#3f6b2e"><circle cx="560" cy="590" r="80"/><circle cx="1120" cy="600" r="95"/><circle cx="1230" cy="620" r="70"/><circle cx="470" cy="620" r="60"/></g>
    <g fill="#5a4332"><rect x="552" y="640" width="16" height="70"/><rect x="1112" y="660" width="16" height="70"/></g>
    <g fill="#e8d44d"><circle cx="220" cy="880" r="7"/><circle cx="420" cy="960" r="7"/><circle cx="980" cy="900" r="7"/><circle cx="1320" cy="980" r="7"/><circle cx="1480" cy="860" r="7"/><circle cx="700" cy="1000" r="7"/></g>
  </svg>`,
)

image(
  'foto-hody-1974',
  'jpg',
  1500,
  1000,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000" viewBox="0 0 1500 1000">
    <rect width="1500" height="1000" fill="#d9c7a3"/>
    <rect x="40" y="40" width="1420" height="920" fill="#bfa77e"/>
    <path d="M40 620 H 1460 V 960 H 40 Z" fill="#8f7a58"/>
    <g fill="#a48d68" stroke="#6e5b3f" stroke-width="4">
      <path d="M90 620 V 380 L 250 280 L 410 380 V 620 Z"/><path d="M440 620 V 420 L 580 330 L 720 420 V 620 Z"/>
      <path d="M1040 620 V 360 L 1220 250 L 1400 360 V 620 Z"/>
    </g>
    <g fill="#5b4a33"><rect x="150" y="450" width="60" height="80"/><rect x="290" y="450" width="60" height="80"/><rect x="540" y="480" width="70" height="140"/><rect x="1120" y="430" width="70" height="90"/><rect x="1260" y="430" width="70" height="90"/></g>
    <g fill="#4a3b28">
      ${Array.from({ length: 13 }, (_, i) => `<g transform="translate(${180 + i * 92} ${700 + (i % 3) * 14})"><circle cx="0" cy="-70" r="20"/><path d="M-24 -46 H 24 L 32 60 H -32 Z"/></g>`).join('')}
    </g>
    <path d="M760 300 V 640" stroke="#4a3b28" stroke-width="10"/>
    <path d="M760 300 C 700 330, 700 250, 760 260 C 820 250, 820 330, 760 300" fill="#7b6748"/>
    <rect x="40" y="40" width="1420" height="920" fill="none" stroke="#f3ead6" stroke-width="26"/>
  </svg>`,
)

rmSync(work, { recursive: true, force: true })
console.log(`\nDemo files are in ${out}`)
