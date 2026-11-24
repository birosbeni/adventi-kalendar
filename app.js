(function () {
  const { DEMO, call, resetDemo } = window.KalendarAPI;
  const app = document.getElementById("app");
  const SESSION_KEY = window.KalendarAPI.DEMO ? "kalendar-demo-session" : "kalendar-session";
  const TAB_KEY = "kalendar-tab";

  // Ajtók sorrendje a naptáron (összekeverve, hogy keresgélni kelljen)
  const ORDER = [7, 15, 2, 21, 11, 4, 18, 9, 23, 1, 13, 6, 20, 3, 16, 24, 10, 5, 14, 19, 8, 22, 12, 17];
  const DECO = ["❄️", "🎄", "⭐", "🔔", "🧦", "🎅", "🍪", "☃️", "🦌", "🕯️", "🎁", "🍭",
                "🧤", "❄️", "🎄", "⭐", "🔔", "🧦", "🍪", "☃️", "🦌", "🕯️", "🎁", "🌟"];
  const AVATARS = ["🦌", "⛄", "🧸", "🐧", "🦊", "🐻‍❄️"];

  const ERRORS = {
    BAD_PIN: "Hibás PIN kód 🙈",
    NO_PIN: "Még nincs PIN kód beállítva.",
    PIN_FORMAT: "A PIN 4–8 számjegyből álljon.",
    ALREADY_SETUP: "Már be van állítva a naptár – frissítsd az oldalt.",
    NEED_2_NAMES: "Legalább két név kell.",
    DUPLICATE_NAME: "Két egyforma név van megadva.",
    LOCKED: "Ez az ajtó még zárva van 🤫",
    ALREADY_OPEN: "Ez a nap már kinyílt, nem módosítható.",
    BAD_IMAGE: "Ezt a képet nem sikerült feltölteni (túl nagy?).",
    TEXT_TOO_LONG: "Túl hosszú a szöveg.",
    NOT_DRAWN: "Előbb húzz valakit!",
    NO_PERSON: "Nincs ilyen ember.",
  };
  const errText = (e) => {
    const m = (e && e.message) || String(e);
    const code = Object.keys(ERRORS).find((k) => m.includes(k));
    if (code) return ERRORS[code];
    if (m.includes("Failed to fetch")) return "Nincs internetkapcsolat? Próbáld újra.";
    return m;
  };

  // ---------- kis segédek ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "style") el.style.cssText = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const mount = (...nodes) => {
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    app.replaceChildren(...nodes);
  };
  const loading = () => mount(h("div", { class: "loading" }, "🎁"));

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
  const decDate = (year, d) => `${year}-12-${String(d).padStart(2, "0")}`;

  const getSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  };
  const setSession = (s) => {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  };

  let session = null; // {id, pin}
  let me = null; // login válasz
  const auth = () => ({ p_id: session.id, p_pin: session.pin });

  function setUserbar() {
    const bar = document.getElementById("userbar");
    bar.hidden = !me;
    if (me) document.getElementById("userbar-name").textContent = "Szia, " + me.name + "! 👋";
  }

  // ---------- Képernyők ----------
  async function start() {
    loading();
    const s = getSession();
    if (s) {
      try {
        session = s;
        me = await call("login", auth());
        setUserbar();
        return me.drawn ? renderMain() : renderDraw();
      } catch (e) {
        setSession(null);
        session = null;
      }
    }
    renderLogin();
  }

  async function renderLogin() {
    me = null;
    setUserbar();
    loading();
    let people;
    try {
      people = await call("list_people");
    } catch (e) {
      return mount(h("div", { class: "card" }, h("h2", {}, "Hoppá"), h("p", {}, errText(e)),
        h("button", { class: "btn", onclick: renderLogin }, "Újra")));
    }
    if (!people.length) return renderSetup();
    mount(
      h("div", { class: "card" },
        h("h2", {}, "Ki vagy?"),
        h("p", {}, "Válaszd ki a neved, és lépj be a saját PIN kódoddal."),
        h("div", { class: "people" },
          people.map((p, i) =>
            h("button", { class: "person-btn", onclick: () => renderPin(p) },
              h("span", { class: "avatar" }, AVATARS[i % AVATARS.length]),
              h("span", {}, p.name, h("small", {}, p.has_pin ? "belépés PIN kóddal" : "első belépés ✨"))
            )
          )
        )
      )
    );
  }

  function renderSetup() {
    const inputs = [0, 1, 2].map((i) =>
      h("input", { type: "text", maxlength: 40, placeholder: i + 1 + ". név", autocomplete: "off" })
    );
    const err = h("p", { class: "error" });
    const btn = h("button", { class: "btn block", type: "submit" }, "Kész, mehet! 🎄");
    mount(
      h("form", {
          class: "card",
          onsubmit: async (ev) => {
            ev.preventDefault();
            err.textContent = "";
            btn.disabled = true;
            try {
              await call("setup", { p_names: inputs.map((i) => i.value) });
              renderLogin();
            } catch (e) {
              err.textContent = errText(e);
              btn.disabled = false;
            }
          },
        },
        h("h2", {}, "Kik vagytok?"),
        h("p", {}, "Írjátok be a neveteket. Ezt csak egyszer kell megcsinálni – utána mindenki a saját nevére kattintva lép be."),
        inputs.map((i) => h("label", { class: "field" }, i)),
        err,
        btn
      )
    );
    inputs[0].focus();
  }

  function renderPin(person) {
    const isNew = !person.has_pin;
    const pin = h("input", {
      class: "pin-input", type: "password", inputmode: "numeric", pattern: "[0-9]*",
      maxlength: 8, autocomplete: isNew ? "new-password" : "current-password", placeholder: "••••",
    });
    const pin2 = isNew
      ? h("input", { class: "pin-input", type: "password", inputmode: "numeric", pattern: "[0-9]*", maxlength: 8, placeholder: "••••" })
      : null;
    const err = h("p", { class: "error" });
    const btn = h("button", { class: "btn block", type: "submit" }, isNew ? "PIN beállítása" : "Belépés");
    mount(
      h("form", {
          class: "card",
          onsubmit: async (ev) => {
            ev.preventDefault();
            err.textContent = "";
            if (isNew && pin.value !== pin2.value) return (err.textContent = "A két PIN nem egyezik.");
            if (!/^\d{4,8}$/.test(pin.value)) return (err.textContent = ERRORS.PIN_FORMAT);
            btn.disabled = true;
            try {
              session = { id: person.id, pin: pin.value };
              me = await call("login", auth());
              setSession(session);
              setUserbar();
              me.drawn ? renderMain() : renderDraw();
            } catch (e) {
              err.textContent = errText(e);
              btn.disabled = false;
              pin.select();
            }
          },
        },
        h("h2", {}, "Szia, " + person.name + "!"),
        h("p", {}, isNew
          ? "Válassz egy 4–8 jegyű PIN kódot. Ezzel tudsz majd belépni bármelyik eszközről – ne áruld el senkinek! 🤫"
          : "Írd be a PIN kódod."),
        h("label", { class: "field" }, h("span", {}, "PIN"), pin),
        pin2 && h("label", { class: "field" }, h("span", {}, "PIN még egyszer"), pin2),
        err,
        btn,
        h("p", {}, h("button", { class: "link", type: "button", onclick: renderLogin }, "← vissza"))
      )
    );
    pin.focus();
  }

  async function renderDraw() {
    let people = [];
    try { people = await call("list_people"); } catch {}
    const others = people.map((p) => p.name).filter((n) => n !== me.name);
    const box = h("div", { class: "giftbox" }, "🎁");
    const slot = h("div", { class: "slot" }, "?");
    const info = h("p", {}, "Kisorsolunk neked valakit a többiek közül. Az ő adventi naptárát fogod megtölteni: minden napra rakhatsz bele egy kis üzenetet vagy képet. 💌");
    const err = h("p", { class: "error" });
    const btn = h("button", { class: "btn block" }, "Húzok! 🎲");
    btn.onclick = async () => {
      btn.disabled = true;
      err.textContent = "";
      box.classList.add("shake");
      const result = call("draw", auth());
      // pörgetés
      const names = others.length ? others : ["?"];
      let i = 0, delay = 70;
      const t0 = Date.now();
      let res;
      try {
        while (Date.now() - t0 < 2600 || !res) {
          slot.textContent = names[i++ % names.length];
          await new Promise((r) => setTimeout(r, delay));
          if (Date.now() - t0 > 1500) delay = Math.min(delay * 1.18, 320);
          if (!res) res = await Promise.race([result, new Promise((r) => setTimeout(() => r(null), 0))]);
        }
      } catch (e) {
        box.classList.remove("shake");
        slot.textContent = "?";
        err.textContent = errText(e);
        btn.disabled = false;
        return;
      }
      box.classList.remove("shake");
      box.textContent = "🎉";
      slot.textContent = res.recipient;
      slot.classList.add("final");
      me.drawn = true;
      me.recipient = res.recipient;
      burst();
      info.replaceChildren("Te ", h("b", {}, res.recipient), " naptárát töltöd! Minden napra rakhatsz neki valamit. Pszt, ez titok! 🤫");
      btn.textContent = "Kezdjük! ✨";
      btn.disabled = false;
      btn.onclick = () => renderMain("fill");
    };
    mount(h("div", { class: "card draw-stage" }, h("h2", {}, "Sorsolás"), box, slot, info, err, btn));
  }

  async function renderMain(tab) {
    tab = tab || sessionStorage.getItem(TAB_KEY) || "mine";
    sessionStorage.setItem(TAB_KEY, tab);
    const tabs = h("div", { class: "tabs", role: "tablist" },
      h("button", { class: "tab", role: "tab", "aria-selected": String(tab === "mine"), onclick: () => renderMain("mine") }, "🎄 Az én naptáram"),
      h("button", { class: "tab", role: "tab", "aria-selected": String(tab === "fill"), onclick: () => renderMain("fill") }, "✍️ " + me.recipient + " naptára")
    );
    const body = h("div", {}, h("div", { class: "loading" }, "🎁"));
    mount(tabs, body);
    try {
      if (tab === "mine") await renderMine(body);
      else await renderFill(body);
    } catch (e) {
      if (/BAD_PIN|NO_PERSON/.test(e.message)) { setSession(null); return renderLogin(); }
      body.replaceChildren(h("div", { class: "card" }, h("h2", {}, "Hoppá"), h("p", {}, errText(e)),
        h("button", { class: "btn", onclick: () => renderMain(tab) }, "Újra")));
    }
  }

  function doorEl(d, extraClass, kids, onclick) {
    return h("button", {
        class: `door c${(d * 7) % 6} d${d} ${extraClass}`,
        "aria-label": "December " + d + ".",
        onclick,
      },
      h("span", { class: "door-back" }, "✨"),
      h("span", { class: "door-front" },
        h("span", { class: "num" }, d),
        h("span", { class: "deco" }, DECO[d - 1]),
        kids
      )
    );
  }

  async function renderMine(body) {
    const cal = await call("my_calendar", auth());
    const today = cal.today;
    const year = me.year || 2026;
    const byDay = Object.fromEntries(cal.days.map((x) => [x.day, x]));
    const toFirst = dayNum(decDate(year, 1)) - dayNum(today);

    const intro = [];
    if (toFirst > 0) {
      intro.push(h("div", { class: "countdown" }, toFirst === 1 ? "Holnap nyílik az első ajtó! 🥳" : `Még ${toFirst} nap, és nyílik az első ajtó! ⏳`));
    }
    intro.push(h("p", { class: "hint" }, "Minden nap kinyithatsz egy ajtót. A ", h("b", {}, "mai"), " ajtó ragyog – keresd meg! ✨"));

    const grid = h("div", { class: "calendar" },
      ORDER.map((d) => {
        const x = byDay[d];
        const cls = [
          x.unlocked ? "" : "is-locked",
          x.opened ? "is-open" : "",
          decDate(year, d) === today ? "is-today" : "",
        ].join(" ");
        const el = doorEl(d, cls, [h("span", { class: "knob" })], () => onDoor(el, x, today, year));
        return el;
      })
    );
    body.replaceChildren(...intro, grid);
  }

  async function onDoor(el, x, today, year) {
    if (!x.unlocked) {
      el.classList.remove("wiggle");
      void el.offsetWidth;
      el.classList.add("wiggle");
      const diff = dayNum(decDate(year, x.day)) - dayNum(today);
      return toast(diff === 1 ? "Holnap nyílik! Türelem 🤫" : `Még ${diff} nap, türelem! 🤫`);
    }
    const firstTime = !el.classList.contains("is-open");
    el.classList.add("is-open");
    const req = call("open_day", { ...auth(), p_day: x.day });
    if (firstTime) await new Promise((r) => setTimeout(r, 750));
    let data;
    try {
      data = await req;
    } catch (e) {
      return toast(errText(e));
    }
    x.opened = true;
    if (firstTime) burst(el);
    showReveal(data);
  }

  function showReveal(data) {
    const dlg = document.getElementById("reveal");
    document.getElementById("reveal-title").textContent = "December " + data.day + ". " + DECO[data.day - 1];
    const body = document.getElementById("reveal-body");
    const parts = [];
    if (data.image && /^data:image\//.test(data.image)) parts.push(h("img", { src: data.image, alt: "" }));
    if (data.body && data.body.trim()) parts.push(h("p", { class: "reveal-text" }, data.body));
    if (!parts.length) {
      parts.push(h("div", { class: "reveal-empty" }, h("div", { class: "big" }, "🥲"),
        h("p", {}, "Ez az ajtó még üres… Úgy tűnik, valaki elfelejtette megtölteni. Szólj neki! 😄")));
    }
    body.replaceChildren(...parts);
    dlg.showModal();
  }

  async function renderFill(body) {
    const list = await call("given_list", auth());
    const filled = list.filter((x) => x.has_text || x.has_image).length;
    const progress = h("div", { class: "progress" },
      `${filled} / 24 nap megtöltve`,
      h("div", { class: "bar" }, h("i", { style: `width:${(filled / 24) * 100}%` }))
    );
    const hint = h("p", { class: "hint" },
      "Kattints egy napra, és rakj bele szöveget és/vagy képet ", h("b", {}, me.recipient), " számára. ",
      "Egy nap a saját dátumán nyílik ki – onnantól már nem módosítható. 🔒"
    );
    const grid = h("div", { class: "calendar fill-grid" },
      list.map((x) => {
        const isFilled = x.has_text || x.has_image;
        const cls = [isFilled ? "is-filled" : "is-empty", x.locked ? "is-past" : ""].join(" ");
        const icons = h("span", { class: "icons" }, x.locked ? "🔒" : "", x.has_text ? "📝" : "", x.has_image ? "🖼️" : "");
        return doorEl(x.day, cls, [icons], () => openEditor(x.day));
      })
    );
    body.replaceChildren(progress, hint, grid);
  }

  // ---------- Szerkesztő ----------
  const ed = {
    dlg: document.getElementById("editor"),
    title: document.getElementById("editor-title"),
    text: document.getElementById("editor-text"),
    img: document.getElementById("editor-img"),
    empty: document.getElementById("image-empty"),
    file: document.getElementById("editor-file"),
    remove: document.getElementById("editor-remove-img"),
    locked: document.getElementById("editor-locked"),
    save: document.getElementById("editor-save"),
    cancel: document.getElementById("editor-cancel"),
    day: null,
    image: null,
  };

  function setEditorImage(src) {
    ed.image = src;
    ed.img.hidden = !src;
    ed.empty.hidden = !!src;
    ed.remove.hidden = !src || ed.isLocked;
    if (src) ed.img.src = src;
    else ed.img.removeAttribute("src");
  }

  async function openEditor(day) {
    ed.day = day;
    ed.title.textContent = "December " + day + ". " + DECO[day - 1];
    ed.text.value = "";
    ed.isLocked = false;
    setEditorImage(null);
    ed.save.disabled = true;
    ed.file.disabled = true;
    ed.dlg.showModal();
    try {
      const g = await call("given_day", { ...auth(), p_day: day });
      if (ed.day !== day) return;
      ed.isLocked = !!g.locked;
      ed.text.value = g.body || "";
      setEditorImage(g.image || null);
      ed.text.readOnly = ed.isLocked;
      ed.file.disabled = ed.isLocked;
      ed.locked.hidden = !ed.isLocked;
      ed.save.hidden = ed.isLocked;
      ed.save.disabled = false;
      if (!ed.isLocked) ed.text.focus();
    } catch (e) {
      toast(errText(e));
      ed.dlg.close();
    }
  }

  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const max = 1400;
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  ed.file.addEventListener("change", async () => {
    const f = ed.file.files[0];
    ed.file.value = "";
    if (!f) return;
    const day = ed.day;
    ed.save.disabled = true;
    try {
      ed.empty.textContent = "⏳ Kép feldolgozása…";
      const src = await compressImage(f);
      if (ed.day === day) setEditorImage(src);
    } catch (e) {
      toast("Ezt a képet nem sikerült beolvasni 😕");
    } finally {
      ed.empty.textContent = "📷 Kattints ide egy kép kiválasztásához";
      ed.save.disabled = false;
    }
  });
  ed.remove.addEventListener("click", () => setEditorImage(null));
  ed.cancel.addEventListener("click", () => ed.dlg.close());
  ed.save.addEventListener("click", async () => {
    ed.save.disabled = true;
    ed.save.textContent = "Mentés…";
    try {
      await call("save_gift", { ...auth(), p_day: ed.day, p_body: ed.text.value, p_image: ed.image });
      ed.dlg.close();
      toast(ed.text.value.trim() || ed.image ? "Elmentve! 🎁" : "Kiürítve.");
      renderMain("fill");
    } catch (e) {
      toast(errText(e));
    } finally {
      ed.save.disabled = false;
      ed.save.textContent = "Mentés 🎁";
    }
  });

  // modál bezárása a háttérre kattintva
  for (const dlg of document.querySelectorAll("dialog")) {
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }


  // ---------- Fényfüzér ----------
  (function lights() {
    const el = document.querySelector(".lights");
    const n = 13;
    const colors = ["#ff5d6c", "#ffd166", "#7ee0a1", "#7cc6ff", "#ff9ad5"];
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 40");
    svg.setAttribute("preserveAspectRatio", "none");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M0,4 Q25,30 50,8 Q75,30 100,4");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "rgba(255,255,255,.35)");
    path.setAttribute("stroke-width", "1.2");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(path);
    el.append(svg);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      // a két ív menti y koordináta közelítése
      const local = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const y = t < 0.5
        ? (1 - local) ** 2 * 4 + 2 * (1 - local) * local * 30 + local ** 2 * 8
        : (1 - local) ** 2 * 8 + 2 * (1 - local) * local * 30 + local ** 2 * 4;
      const b = h("span", { class: "bulb", style: `left:${t * 100}%;top:${(y / 40) * 100}%;color:${colors[i % colors.length]};animation-delay:${(i % 4) * 0.6}s` });
      el.append(b);
    }
  })();

  // ---------- Hóesés ----------
  const canvas = document.getElementById("snow");
  const ctx = canvas.getContext("2d");
  let flakes = [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(110, (innerWidth * innerHeight) / 11000));
    flakes = Array.from({ length: count }, () => newFlake(true));
  }
  function newFlake(anywhere) {
    return {
      x: Math.random() * innerWidth,
      y: anywhere ? Math.random() * innerHeight : -10,
      r: Math.random() * 2.6 + 0.8,
      vy: Math.random() * 0.6 + 0.35,
      phase: Math.random() * Math.PI * 2,
      o: Math.random() * 0.5 + 0.45,
    };
  }
  let sparks = [];
  function burst(el) {
    const rect = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - 50, top: innerHeight / 2 - 50, width: 100, height: 100 };
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const colors = ["#ffd166", "#ff5d6c", "#7ee0a1", "#ffffff", "#ff9ad5"];
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 5 + 2;
      sparks.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 1, c: colors[i % colors.length], r: Math.random() * 3 + 2 });
    }
    if (reduced) { sparks = []; }
  }
  function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const f of flakes) {
      if (!reduced) {
        f.y += f.vy;
        f.x += Math.sin(t / 1600 + f.phase) * 0.35;
        if (f.y > innerHeight + 10) Object.assign(f, newFlake(false));
      }
      ctx.globalAlpha = f.o;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of sparks) {
      s.x += s.vx; s.y += s.vy; s.vy += 0.15; s.life -= 0.018;
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    sparks = sparks.filter((s) => s.life > 0);
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);

  // ---------- Demó mód ----------
  if (DEMO) {
    document.getElementById("demo-banner").hidden = false;
    const di = document.getElementById("demo-date");
    const params = new URLSearchParams(location.search);
    di.value = params.get("date") || new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date());
    di.addEventListener("change", () => {
      params.set("date", di.value);
      location.search = params.toString();
    });
    document.getElementById("demo-reset").addEventListener("click", () => {
      resetDemo();
      setSession(null);
      location.reload();
    });
  }

  start();
})();
