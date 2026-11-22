# Rozhodnutí mimo zadání

| Rozhodnutí | Proč | Jak změnit |
|---|---|---|
| **Spotřeba podle % baterie × kapacita × koeficient**, ne podle hodin × výkon | Procenta jsou na fotce vždy a nezáleží na tom, jestli nabíječka jela celou dobu na 3,5 kW nebo kdy přesně auto dobilo. Čas × výkon aplikace ukazuje v detailu jako kontrolu. | `calc()` v `js/model.js` |
| **Koeficient léto 1,18 / zima 1,25** místo 1,12 | Měření na Kona 64 kWh: účinnost AC nabíjení 85 % (= 1,18); pomalé 3,5 kW a zima ztráty zvyšují; odhady času na palubní desce odpovídají ~1,25. | Nastavení → Koeficient ztrát |
| **Zima = listopad až březen** podle data začátku | Jednoduché a předvídatelné; u každého startu jde přepnout ručně. | Nastavení → Zimní měsíce |
| **Koeficient a cena se ukládají ke každému nabíjení** | Změna ceny nebo koeficientu nepřepíše už vyúčtované měsíce. Starší záznam jde opravit v detailu → Upravit. | – |
| **Elektroměr** (nepovinné kWh u nabíjení) přebije výpočet | Nejpřesnější údaj; z více měření aplikace spočítá skutečný koeficient a nabídne ho použít. | detail nabíjení |
| **„Dobito“ bez fotky** – konec = limit (90 %), čas = odhad z „Do dobití zbývá“ (nebo teď, pokud je dřív) | Nejčastější případ na jedno ťuknutí. Když se nabilo jinak, je tam „zadat ručně“. | `finishAtTarget()` v `js/app.js` |
| **Čtení fotek přes AI** (Gemini zdarma / Claude), ne offline OCR | Offline OCR na tvých fotkách přečetl % baterie správně jen u 2–3 ze 6. Hodnoty z AI se vždy potvrzují a kontrolují (rozsahy, konec ≥ start, tachometr vs. minule). | `js/reader.js` |
| **Klíč k AI a heslo zálohy jen v telefonu** | Nezálohují se na Disk ani do souboru. | – |
| **Záloha přes vlastní Google Apps Script**, ne přihlášení Google v aplikaci | Bez Google Cloud projektu a OAuth – stačí vložit skript a nasadit. Heslo (TOKEN) chrání, aby zapisoval jen tvůj telefon. | `apps-script/Code.gs` |
| **Při záloze se slučuje** (novější změna záznamu vyhrává, smazání se propíše) | Funguje i se dvěma telefony a obnovou na novém telefonu. | `mergeSessions()` v `js/model.js` |
| **Fotky zmenšené na 1400 px** (~150–250 kB) | Čísla jsou čitelná, telefon se nezaplní; originál zůstává v galerii. | `MAX_SIDE` v `js/photo.js` |
| **PDF = tisk připravené A4 stránky** | Česká diakritika bez knihoven a stejný design; v Chromu „Uložit jako PDF“. | `printReport()` v `js/report.js` |
| **Excel bez knihoven** se vzorci SUM v řádku Celkem | Funguje offline, spolubydlící vidí součty. | `js/xlsx.js`, `js/report.js` |
| **Ukončené nabíjení s chybějícím údajem** = čtvereček v historii | Design: plné kolečko hotovo, čárkované probíhá, čtvereček něco chybí. | `sessRow()` |
