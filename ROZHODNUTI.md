# Rozhodnutí mimo zadání

| Rozhodnutí | Proč | Jak změnit |
|---|---|---|
| **Ze sítě = doba nabíjení × výkon z palubní desky** (do baterie = nabito % × 64 kWh) | Výkon na palubní desce je odběr ze zásuvky – ověřeno měřením Kony a odhady času v autě (při 3,5 kW jde do baterie ~2,75 kW). Ztráty jsou tedy v čísle už obsažené. Původně jsem počítal % × koeficient; dává podobný výsledek (1,25 vs. skutečných ~1,26–1,28), ale doba × výkon je přímý údaj. | `calc()` v `js/model.js` |
| **Koeficient (zima 1,25 / léto 1,18) jen jako záloha** | Použije se, když chybí čas nebo výkon, když doba × výkon nesedí s % baterie, a na odhad „do baterie“ u importu. | Nastavení → Jak se počítá |
| **Doba nabíjení končí nejpozději dobitím** | Když baterie skončila na limitu a konec zapíšeš později, auto už stálo – počítá se jen do odhadovaného dobití. | `calc()` |
| **Zima = listopad až březen** podle data začátku | Jednoduché a předvídatelné; u každého startu jde přepnout ručně. | Nastavení → Zimní měsíce |
| **Koeficient a cena se ukládají ke každému nabíjení** | Změna ceny nebo koeficientu nepřepíše už vyúčtované měsíce. Starší záznam jde opravit v detailu → Upravit. | – |
| **Elektroměr** (nepovinné kWh u nabíjení) přebije výpočet | Nejpřesnější údaj. | detail nabíjení |
| **„Dobito“ bez fotky** – konec = limit (90 %), čas = odhad z „Do dobití zbývá“ (nebo teď, pokud je dřív) | Nejčastější případ na jedno ťuknutí. Když se nabilo jinak, je tam „zadat ručně“. | `finishAtTarget()` v `js/app.js` |
| **Čtení fotek přes AI** (Gemini zdarma / Claude), ne offline OCR | Offline OCR na tvých fotkách přečetl % baterie správně jen u 2–3 ze 6. Hodnoty z AI se vždy potvrzují a kontrolují (rozsahy, konec ≥ start, tachometr vs. minule). | `js/reader.js` |
| **Klíč k AI a heslo zálohy jen v telefonu** | Nezálohují se na Disk ani do souboru. | – |
| **Záloha přes vlastní Google Apps Script**, ne přihlášení Google v aplikaci | Bez Google Cloud projektu a OAuth – stačí vložit skript a nasadit. Heslo (TOKEN) chrání, aby zapisoval jen tvůj telefon. | `apps-script/Code.gs` |
| **Při záloze se slučuje** (novější změna záznamu vyhrává, smazání se propíše) | Funguje i se dvěma telefony a obnovou na novém telefonu. | `mergeSessions()` v `js/model.js` |
| **Fotky zmenšené na 1400 px** (~150–250 kB) | Čísla jsou čitelná, telefon se nezaplní; originál zůstává v galerii. | `MAX_SIDE` v `js/photo.js` |
| **PDF = tisk připravené A4 stránky** | Česká diakritika bez knihoven a stejný design; v Chromu „Uložit jako PDF“. | `printReport()` v `js/report.js` |
| **Excel bez knihoven** se vzorci SUM v řádku Celkem | Funguje offline, spolubydlící vidí součty. | `js/xlsx.js`, `js/report.js` |
| **Ukončené nabíjení s chybějícím údajem** = čtvereček v historii | Design: plné kolečko hotovo, čárkované probíhá, čtvereček něco chybí. | `sessRow()` |
