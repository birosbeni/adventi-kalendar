// Adatréteg: valódi Supabase RPC hívások, vagy demó mód localStorage-ban (ugyanazzal a logikával).
(function () {
  const cfg = window.KALENDAR_CONFIG || {};
  const DEMO = !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY || new URLSearchParams(location.search).has("demo");

  // ---------- Valódi backend ----------
  async function rpc(fn, args) {
    const headers = { "Content-Type": "application/json", apikey: cfg.SUPABASE_KEY };
    if (cfg.SUPABASE_KEY.startsWith("eyJ")) headers.Authorization = "Bearer " + cfg.SUPABASE_KEY;
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers,
      body: JSON.stringify(args || {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.message) || "HTTP " + res.status);
    return data;
  }

  // ---------- Demó backend ----------
  const KEY = "kalendar-demo-db";
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"people":[],"gifts":{},"opens":{}}');
  const store = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  const YEAR = 2026;
  function today() {
    const o = new URLSearchParams(location.search).get("date");
    if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date());
  }
  const unlocked = (d) => today() >= `${YEAR}-12-${String(d).padStart(2, "0")}`;
  function auth(db, id, pin) {
    const p = db.people.find((x) => x.id === id);
    if (!p) throw new Error("NO_PERSON");
    if (p.pin == null) throw new Error("NO_PIN");
    if (p.pin !== pin) throw new Error("BAD_PIN");
    return p;
  }
  const gift = (db, giverId, d) => db.gifts[giverId + ":" + d];
  const giverOf = (db, p) => db.people.find((x) => x.recipient_id === p.id);

  const demo = {
    list_people() {
      return load().people.map((p) => ({ id: p.id, name: p.name, has_pin: p.pin != null }));
    },
    setup({ p_names }) {
      const db = load();
      if (db.people.length) throw new Error("ALREADY_SETUP");
      const names = p_names.map((n) => n.trim()).filter(Boolean);
      if (names.length < 2) throw new Error("NEED_2_NAMES");
      if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error("DUPLICATE_NAME");
      db.people = names.map((name, i) => ({ id: i + 1, name, pin: null, recipient_id: null, drawn: false }));
      store(db);
    },
    login({ p_id, p_pin }) {
      const db = load();
      let p = db.people.find((x) => x.id === p_id);
      if (!p) throw new Error("NO_PERSON");
      if (p.pin == null) {
        if (!/^[0-9]{4,8}$/.test(p_pin)) throw new Error("PIN_FORMAT");
        p.pin = p_pin;
        store(db);
      } else auth(db, p_id, p_pin);
      const r = p.drawn ? db.people.find((x) => x.id === p.recipient_id).name : null;
      return { id: p.id, name: p.name, drawn: p.drawn, recipient: r, today: today(), year: YEAR };
    },
    draw({ p_id, p_pin }) {
      const db = load();
      const p = auth(db, p_id, p_pin);
      if (db.people.some((x) => x.recipient_id == null)) {
        const ids = db.people.map((x) => x.id).sort(() => Math.random() - 0.5);
        ids.forEach((id, i) => (db.people.find((x) => x.id === id).recipient_id = ids[(i + 1) % ids.length]));
      }
      p.drawn = true;
      store(db);
      return { recipient: db.people.find((x) => x.id === p.recipient_id).name };
    },
    my_calendar({ p_id, p_pin }) {
      const db = load();
      const p = auth(db, p_id, p_pin);
      const g = giverOf(db, p);
      return {
        today: today(),
        days: Array.from({ length: 24 }, (_, i) => {
          const d = i + 1;
          const x = g && gift(db, g.id, d);
          return { day: d, unlocked: unlocked(d), has_gift: !!x, opened: !!db.opens[p.id + ":" + d] };
        }),
      };
    },
    open_day({ p_id, p_pin, p_day }) {
      const db = load();
      const p = auth(db, p_id, p_pin);
      if (!unlocked(p_day)) throw new Error("LOCKED");
      db.opens[p.id + ":" + p_day] = true;
      store(db);
      const g = giverOf(db, p);
      const x = (g && gift(db, g.id, p_day)) || {};
      return { day: p_day, body: x.body || null, image: x.image || null };
    },
    given_list({ p_id, p_pin }) {
      const db = load();
      const p = auth(db, p_id, p_pin);
      if (!p.drawn) throw new Error("NOT_DRAWN");
      return Array.from({ length: 24 }, (_, i) => {
        const x = gift(db, p.id, i + 1) || {};
        return { day: i + 1, locked: unlocked(i + 1), has_text: !!x.body, has_image: !!x.image };
      });
    },
    given_day({ p_id, p_pin, p_day }) {
      const db = load();
      const p = auth(db, p_id, p_pin);
      const x = gift(db, p.id, p_day) || {};
      return { day: p_day, body: x.body || null, image: x.image || null, locked: unlocked(p_day) };
    },
    save_gift({ p_id, p_pin, p_day, p_body, p_image }) {
      const db = load();
      const p = auth(db, p_id, p_pin);
      if (!p.drawn) throw new Error("NOT_DRAWN");
      if (unlocked(p_day)) throw new Error("ALREADY_OPEN");
      const k = p.id + ":" + p_day;
      if (!(p_body || "").trim() && !p_image) delete db.gifts[k];
      else db.gifts[k] = { body: p_body, image: p_image };
      try {
        store(db);
      } catch (e) {
        throw new Error("Demó módban betelt a böngésző tárhelye – próbálj kisebb képet.");
      }
    },
  };

  async function call(fn, args) {
    if (DEMO) {
      await new Promise((r) => setTimeout(r, 120));
      return demo[fn](args || {});
    }
    return rpc(fn, args);
  }

  window.KalendarAPI = { DEMO, call, resetDemo: () => localStorage.removeItem(KEY) };
})();
