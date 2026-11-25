# Adventi Kalendár 🎄

Közös adventi naptár 3 barátnőnek: mindenki kisorsol valakit, és az ő naptárába rak minden napra egy
üzenetet és/vagy képet, a sajátját pedig minden nap kinyithatja.

- **Frontend:** sima HTML/CSS/JS (`index.html`, `style.css`, `app.js`, `api.js`), GitHub Pages-en hostolva.
- **Backend:** Supabase (ingyenes), csak PIN-nel védett függvényeken keresztül érhető el (`supabase.sql`).
  A napok zárolását a szerver ellenőrzi (Budapest idő szerint), így előre belesni sem lehet.

## Beállítás

1. https://supabase.com → ingyenes fiók → **New project** (régió: Frankfurt/EU).
2. A projektben **SQL Editor** → másold be a `supabase.sql` teljes tartalmát → **Run**.
3. **Project Settings → API**: másold ki a *Project URL*-t és a *publishable* (vagy `anon`) kulcsot,
   és írd be a `config.js`-be.
4. Push a GitHubra → Pages bekapcsolva a `main` ágon.

## Kipróbálás helyben (demó mód)

Ha a `config.js` üres, az oldal demó módban fut (minden a böngészőben tárolódik), és a dátum is
állítható, így ki lehet próbálni a december 1–24 közötti napokat:

```bash
python3 -m http.server 8765
```

Majd: http://localhost:8765/?date=2026-12-05

## Tudnivalók

- A Supabase ingyenes projektek 7 nap inaktivitás után szüneteltetődnek – adventben napi használat mellett ez nem gond,
  de ha előtte sokáig senki nem nyúl hozzá, a Supabase felületén egy kattintással újraindítható.
- Jövőre: `supabase.sql`-ben a `_advent_year()` értékét kell átírni.

## Második, független naptár (`ketten/`)

A `ketten/` mappa ugyanazt a kódot használja, de saját `ketten/config.js`-sel és saját Supabase projekttel,
így semmilyen adatuk nem közös. Link: https://birosbeni.github.io/adventi-kalendar/ketten/
Beállítás: új Supabase projekt → SQL Editorban `supabase.sql` lefuttatása → URL + publishable key a `ketten/config.js`-be.
