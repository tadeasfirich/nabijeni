# Nastavení krok za krokem

## 1. GitHub Pages (5 minut)

1. github.com/tadeasfirich/nabijeni → **Settings** → **Pages**.
2. *Source:* **Deploy from a branch**, *Branch:* **main**, složka **/ (root)** → **Save**.
3. Za 1–2 minuty běží na **https://tadeasfirich.github.io/nabijeni/**.
4. V telefonu otevři adresu v Chromu → menu ⋮ → **Přidat na plochu / Nainstalovat aplikaci**.

Nová verze: po nahrání změn do `main` zvyš v `sw.js` číslo `VERSION` (např. `nabijeni-v2`), ať si telefon stáhne nové soubory.

## 2. Čtení fotek – klíč Gemini (zdarma, 3 minuty)

1. Otevři https://aistudio.google.com/apikey (přihlas se Google účtem).
2. **Create API key** → zkopíruj klíč (začíná `AIza…`).
3. V aplikaci: **Nastavení → Čtení údajů z fotky → Gemini → Klíč** → vlož.
4. **Vyzkoušet na ukázkové fotce** → má vyjít 48 %, 9 h 50 min, 3,5 kW, 90 887 km.

Když Google model přejmenuje nebo vyřadí a test hlásí „model nenalezen“, napiš do pole *Model* aktuální název
Flash modelu z AI Studia (výchozí `gemini-flash-latest` ukazuje vždy na aktuální Flash).

Alternativa: **Claude** – klíč z https://console.anthropic.com/settings/keys (placené, je potřeba dobít kredit).

## 3. Záloha na Google Disk (10 minut)

1. Otevři https://script.google.com → **Nový projekt**. Pojmenuj ho „Nabíjení – záloha“.
2. Smaž obsah `Kód.gs` a vlož celý soubor [apps-script/Code.gs](apps-script/Code.gs).
3. Na řádku `const TOKEN = 'ZMEN-MĚ-na-dlouhe-heslo';` napiš vlastní dlouhé heslo (např. 20 náhodných znaků). Ulož (Ctrl+S).
4. Nahoře vyber funkci **setup** → **▶ Spustit** → **Zkontrolovat oprávnění** → svůj účet →
   „Google tuto aplikaci neověřil“ → **Rozšířené** → **Přejít na Nabíjení – záloha (nebezpečné)** → **Povolit**.
   (Je to tvůj vlastní skript, přístup má jen k tvému Disku.) Na Disku vznikne složka **Nabíjení Kony**.
5. **Nasadit → Nové nasazení** → ozubené kolo → **Webová aplikace**:
   - *Spustit jako:* **Já**
   - *Kdo má přístup:* **Kdokoli**
   → **Nasadit** → zkopíruj **URL webové aplikace** (končí `/exec`).
6. V aplikaci: **Nastavení → Záloha na Google Disk** → vlož adresu a stejné heslo → **Otestovat spojení** →
   zaškrtni **Zálohovat na Google Disk**.

Když skript později upravíš, musíš ho znovu nasadit: **Nasadit → Spravovat nasazení → tužka → Verze: Nová verze → Nasadit**
(adresa zůstane stejná).

Co je na Disku ve složce **Nabíjení Kony**:

| Soubor | K čemu |
|---|---|
| `nabijeni-data.json` | kompletní data, z nich se obnovuje nový telefon |
| `Nabíjení – evidence` | Google tabulka všech nabíjení se součty (přepisuje se při každé záloze – needituj ji, úpravy dělej v aplikaci) |
| `Fotky/` | fotky palubní desky, např. `2026-11-22 2014 start 21%.jpg` |
| `Zálohy/` | jedna kopie dat za každý měsíc |

## 4. Nový telefon

Nainstaluj aplikaci (bod 1), vlož klíč Gemini (bod 2), v Nastavení vyplň adresu skriptu a heslo → **Obnovit z Disku**.
Fotky zůstanou na Disku, v detailu nabíjení na ně vede odkaz.
