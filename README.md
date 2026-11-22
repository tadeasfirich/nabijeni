# Nabíjení

Webová aplikace (PWA) na evidenci nabíjení elektromobilu (Hyundai Kona Electric 2021, 64 kWh)
ze společné elektřiny v domě. Vyfotíš palubní desku, aplikace přečte údaje a ty je jen potvrdíš.
Spotřebu přepočítá na kWh ze sítě a Kč a vyexportuje ji do Excelu nebo PDF za měsíc či libovolné období.

**Adresa:** https://tadeasfirich.github.io/nabijeni/ (po zapnutí GitHub Pages – viz [NASTAVENI.md](NASTAVENI.md))

## Jak se používá

1. **Večer:** připojíš kabel → **Vyfotit a začít** → AI přečte baterii (21 %), „do dobití zbývá“ (15 h 50 min),
   výkon (3,5 kW) a tachometr → zkontroluješ → **Uložit začátek**.
2. **Ráno, když je dobito:** **Dobito – 90 %** → jedno potvrzení. Hotovo.
3. **Když odjíždíš dřív:** **Ukončit dříve – vyfotit** → AI přečte aktuální % (např. 85 %), aplikace hned ukáže
   rozdíl a výpočet (64 % × 64 kWh = 40,96 kWh × 1,25 = 51,20 kWh × 6,70 Kč = 343,04 Kč) → potvrdíš.
4. **Přehled:** zvolíš měsíc nebo období od–do → **Stáhnout Excel**, **PDF / tisk** nebo **Poslat Excel** (sdílení).

Bez internetu nebo bez klíče AI vyplníš čísla ručně (tlačítka + / − u baterie), fotka se uloží i tak.
Starší fotku lze vybrat z galerie – čas se vezme z fotky (EXIF).

## Výpočet

```
ze sítě (kWh) = nabito % ÷ 100 × 64 kWh × koeficient ztrát
částka (Kč)   = ze sítě × cena za kWh (výchozí 6,70 Kč)
```

Koeficient: **léto 1,18, zima 1,25** (zimní měsíce listopad–březen, dají se přepnout). Každé nabíjení si pamatuje
koeficient a cenu, se kterými vzniklo – změna v nastavení nepřepíše historii.
Když u nabíjení zapíšeš údaj z elektroměru (měřák v zásuvce), použije se místo výpočtu a aplikace z měření
spočítá skutečný koeficient (Přehled → Kalibrace, Nastavení → „použít naměřený“).

Proč ne 1,12: měření přímo na Kona Electric 64 kWh (Mašek, Závodník: *Účinnost a rychlost nabíjení elektromobilů*,
Perner's Contacts 2023, Univerzita Pardubice) vyšlo na průměrnou účinnost AC nabíjení **85 % → koeficient ≈ 1,18**.
Při pomalém nabíjení 3,5 kW tvoří větší podíl stálá spotřeba elektroniky auta, v zimě navíc ohřev baterie. Odhady času
přímo z palubní desky (např. 21 → 90 % za 15 h 50 min při 3,5 kW) odpovídají koeficientu kolem 1,25.

## Čtení fotek – co jsme testovali

Na šesti skutečných fotkách palubní desky:

| Způsob | Výsledek |
|---|---|
| Offline OCR (Tesseract, i s ořezem podle kruhu na displeji) | tachometr většinou OK, **% baterie správně jen u 2–3 fotek ze 6** → nespolehlivé |
| AI (Gemini / Claude) | čte celý displej včetně „(90%)“, času a kW; aplikace hodnoty ještě kontroluje (rozsahy, tachometr vs. minule, konec ≥ start) |

Proto se čte přes AI: **Gemini** (klíč zdarma z Google AI Studia) nebo **Claude** (placené, asi haléř za fotku).
Klíč je uložený jen v telefonu. Vždy vidíš fotku i přečtené hodnoty a potvrzuješ je ty.

## Data a záloha

- Vše je v telefonu (IndexedDB) – aplikace se otevře a jede i bez internetu.
- Záloha na **Google Disk** přes vlastní Google Apps Script ([apps-script/Code.gs](apps-script/Code.gs)):
  složka „Nabíjení Kony“ s daty (JSON), Google tabulkou všech nabíjení, fotkami a měsíčními kopiemi.
  Zálohuje se samo po každé změně; offline počká na internet. Vypnout jde jedním zaškrtnutím.
- Na novém telefonu: Nastavení → Záloha → vyplnit adresu a heslo → **Obnovit z Disku**.
- Navíc ruční záloha do souboru `.json` (Nastavení → Data v telefonu).

## Technicky

Čisté HTML + JavaScript moduly, žádný build, žádné knihovny. Excel (.xlsx) zapisuje vlastní kód (převzatý z aplikace
Inventura), PDF vzniká tiskem připravené A4 stránky („Uložit jako PDF“).

```
index.html, styles.css, sw.js, manifest.webmanifest
js/app.js      obrazovky: Nabíjení, potvrzení fotky, detail, Přehled, Nastavení
js/model.js    výpočty, kontroly, slučování (čisté funkce)
js/data.js     IndexedDB: nastavení, nabíjení, fotky
js/photo.js    zmenšení fotky, čas z EXIF
js/reader.js   čtení fotky přes Gemini / Claude
js/sync.js     záloha na Google Disk (Apps Script)
js/report.js   Excel, PDF/tisk, řádky pro Google tabulku
js/xlsx.js, js/zip.js   zápis .xlsx bez knihoven
apps-script/   skript pro Google Disk
docs/test-foto.jpg      ukázková fotka pro test čtení (48 %, 90 887 km)
```

Dokumentace: [NASTAVENI.md](NASTAVENI.md) (zprovoznění krok za krokem), [ROZHODNUTI.md](ROZHODNUTI.md) (co jsem rozhodl mimo zadání).
