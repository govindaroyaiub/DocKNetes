(function () {
  "use strict";

  // ------------------------------------------------------------ storage
  const KEY = "shipit-v2";
  const THEME_KEY = "shipit-theme";
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: progress lives in memory */ } },
  };

  const saved = store.get(KEY, null);
  const state = {
    done: (saved && saved.done) || {},
    sim: (saved && saved.sim) || Sim.createState(),
    view: (saved && saved.view) || { screen: "home" },
  };
  const save = () => store.set(KEY, { done: state.done, sim: state.sim, view: state.view });

  // Keep the address bar clean: no #anchors, ever.
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);

  // ------------------------------------------------------------ course helpers
  const COURSE = window.COURSE;
  const mid = (m, l, i) => `${m.id}/${l.id}/${i}`;
  const totalMissions = COURSE.reduce((a, m) => a + m.lessons.reduce((b, l) => b + l.missions.length, 0), 0);
  const lessonDone = (m, l) => l.missions.every((_, i) => state.done[mid(m, l, i)]);
  const moduleDone = (m) => m.lessons.every((l) => lessonDone(m, l));
  const moduleUnlocked = (mi) => mi === 0 || moduleDone(COURSE[mi - 1]);
  const lessonUnlocked = (mi, li) => moduleUnlocked(mi) && COURSE[mi].lessons.slice(0, li).every((l) => lessonDone(COURSE[mi], l));
  const currentMission = (m, l) => l.missions.findIndex((_, i) => !state.done[mid(m, l, i)]);
  const doneCount = () => Object.keys(state.done).length;
  const moduleCount = (m) => m.lessons.reduce((a, l) => a + l.missions.filter((_, i) => state.done[mid(m, l, i)]).length, 0);
  const moduleTotal = (m) => m.lessons.reduce((a, l) => a + l.missions.length, 0);

  function nextStop() {
    for (let mi = 0; mi < COURSE.length; mi++)
      for (let li = 0; li < COURSE[mi].lessons.length; li++)
        if (!lessonDone(COURSE[mi], COURSE[mi].lessons[li])) return { mi, li };
    return null;
  }

  // ------------------------------------------------------------ dom helpers
  const app = document.getElementById("app");
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v; // only ever course text we wrote ourselves
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "style") n.style.cssText = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  }
  const icon = {
    lock: () => svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    check: () => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    arrow: () => svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    back: () => svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    book: () => svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>'),
    ext: () => svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    reset: () => svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 3.5v5h5"/>'),
  };
  function svg(inner) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = inner;
    return s;
  }

  // ------------------------------------------------------------ top bar
  function updateTop() {
    document.getElementById("topFill").style.width = (doneCount() / totalMissions) * 100 + "%";
    document.getElementById("topCount").textContent = `${doneCount()}/${totalMissions}`;
  }
  document.getElementById("brand").addEventListener("click", () => go({ screen: "home" }));
  document.getElementById("themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch { /* ignore */ }
    document.querySelector('meta[name="theme-color"]').content = root.dataset.theme === "dark" ? "#101216" : "#f3efe6";
  });

  function go(view) {
    state.view = view;
    save();
    render();
    window.scrollTo({ top: 0 });
  }

  // ------------------------------------------------------------ HOME
  function renderHome() {
    const stop = nextStop();
    const started = doneCount() > 0;
    const hero = h("section", { class: "hero" },
      h("div", { class: "hero-copy" },
        h("p", { class: "kicker" }, "Docker · Compose · Deploy · Kubernetes"),
        h("h1", {}, "Learn Docker", h("br"), h("span", {}, "by typing.")),
        h("p", { class: "hero-sub" }, "No long reading. Every lesson is a handful of missions in a practice terminal. Type the command, see what real Docker would say, unlock the next one."),
        stop
          ? h("button", { class: "cta", type: "button", onclick: () => go({ screen: "lesson", mi: stop.mi, li: stop.li }) },
              h("span", {}, started ? "Continue" : "Start mission 1"),
              h("small", {}, `${COURSE[stop.mi].title} · ${COURSE[stop.mi].lessons[stop.li].title}`),
              icon.arrow())
          : h("div", { class: "cta done" }, h("span", {}, "Course complete 🎉"), h("small", {}, "Replay any module below"))
      ),
      heroTerminal()
    );

    const yard = h("section", { class: "yard", "aria-label": "Modules" });
    COURSE.forEach((m, mi) => {
      const unlocked = moduleUnlocked(mi);
      const complete = moduleDone(m);
      const pct = Math.round((moduleCount(m) / moduleTotal(m)) * 100);
      const status = complete ? "Done" : !unlocked ? "Locked" : pct > 0 ? "In progress" : "Ready";
      const target = () => go({ screen: "module", mi });
      yard.append(
        h("button", {
          class: `crate c-${m.color} ${unlocked ? "" : "locked"} ${complete ? "complete" : ""}`,
          type: "button", style: `--d:${mi * 70}ms`,
          disabled: !unlocked,
          "aria-label": `${m.title}: ${status}`,
          onclick: unlocked ? target : null,
        },
          h("div", { class: "crate-doors" }, h("span", { class: "crate-num" }, String(mi + 1).padStart(2, "0")), h("span", { class: "crate-tag" }, m.tag)),
          h("div", { class: "crate-body" },
            h("h3", {}, m.title),
            h("p", {}, m.blurb),
            h("div", { class: "crate-meta" },
              h("span", { class: `chip s-${status.replace(" ", "-").toLowerCase()}` }, !unlocked ? icon.lock() : complete ? icon.check() : null, status),
              h("span", { class: "crate-count" }, `${m.lessons.length} lessons · ${moduleTotal(m)} missions`)),
            h("div", { class: "bar" }, h("i", { style: `width:${pct}%` }))),
          !unlocked && mi > 0 ? h("div", { class: "crate-lockmsg" }, `Finish “${COURSE[mi - 1].title}” to unlock`) : null
        )
      );
    });

    const foot = h("footer", { class: "foot" },
      h("p", {}, "Progress is saved in this browser. The terminal is a simulator: it behaves like Docker, but nothing runs on your machine."),
      h("button", { class: "linkish", type: "button", onclick: resetAll }, icon.reset(), "Reset all progress"));

    app.replaceChildren(h("div", { class: "home" }, hero, h("h2", { class: "yard-title" }, "The yard", h("span", {}, "6 modules, unlock them in order")), yard, foot));
  }

  function heroTerminal() {
    const lines = [
      ["$ ", "docker run -d -p 8080:80 --name web nginx"],
      ["", "3f9a1c2b7d4e8f0a1b2c3d4e5f6a7b8c"],
      ["$ ", "docker ps"],
      ["", "CONTAINER ID   IMAGE   STATUS         PORTS                  NAMES"],
      ["", "3f9a1c2b7d4e   nginx   Up 2 seconds   0.0.0.0:8080->80/tcp   web"],
      ["ok", "✓ Mission complete"],
    ];
    return h("div", { class: "hero-term", "aria-hidden": "true" },
      h("div", { class: "term-bar" }, h("span", { class: "dot" }), h("span", { class: "dot" }), h("span", { class: "dot" }), h("em", {}, "you@laptop: ~/app")),
      h("pre", {}, ...lines.map(([p, t], i) => h("span", { class: "hl " + (p === "ok" ? "ok" : p ? "cmd" : "out"), style: `--i:${i}` }, p && p !== "ok" ? h("b", {}, p) : null, t))));
  }

  // ------------------------------------------------------------ MODULE overview (revisit chapters)
  function renderModule() {
    const mi = state.view.mi;
    if (!COURSE[mi] || !moduleUnlocked(mi)) return go({ screen: "home" });
    const m = COURSE[mi];
    const pct = Math.round((moduleCount(m) / moduleTotal(m)) * 100);
    const rows = m.lessons.map((l, li) => {
      const open = lessonUnlocked(mi, li);
      const done = lessonDone(m, l);
      const n = l.missions.filter((_, i) => state.done[mid(m, l, i)]).length;
      const status = done ? "Done" : !open ? "Locked" : n ? "In progress" : "Up next";
      return h("li", { class: `lrow ${done ? "done" : ""} ${open ? "" : "locked"}`, style: `--d:${li * 60}ms` },
        h("span", { class: "lnum" }, done ? icon.check() : !open ? icon.lock() : String(li + 1)),
        h("div", { class: "lmain" },
          h("h3", {}, l.title),
          h("p", {}, open ? `${n}/${l.missions.length} missions` : "Finish the lesson above to unlock")),
        h("span", { class: `chip s-${status.replace(" ", "-").toLowerCase()}` }, status),
        open
          ? h("button", { class: done ? "ghost" : "cta small", type: "button", onclick: () => go({ screen: "lesson", mi, li }) },
              done ? "Revisit" : h("span", {}, n ? "Continue" : "Start"), done ? null : icon.arrow())
          : h("span", { class: "lgap" }));
    });
    app.replaceChildren(h("div", { class: `module-page c-${m.color}` },
      h("button", { class: "back", type: "button", onclick: () => go({ screen: "home" }) }, icon.back(), "All modules"),
      h("header", { class: "module-hero" },
        h("div", { class: "module-crate" }, h("span", {}, String(mi + 1).padStart(2, "0"))),
        h("div", {},
          h("p", { class: "kicker" }, `Module ${mi + 1} · ${m.tag}`),
          h("h1", {}, m.title),
          h("p", { class: "hero-sub" }, m.blurb),
          h("div", { class: "bar wide" }, h("i", { style: `width:${pct}%` })))),
      h("ol", { class: "lessons" }, ...rows),
      moduleDone(m) ? h("p", { class: "module-note" }, "Finished lessons stay open. Revisit any of them and replay the missions as practice; your progress is kept.") : null));
  }

  // Rebuild a practice sandbox as it would look right before lesson (mi, li),
  // by replaying every earlier mission's answer. Used for "Replay missions".
  function sandboxBefore(mi, li) {
    const S = Sim.createState();
    outer: for (let a = 0; a < COURSE.length; a++) {
      for (let b = 0; b < COURSE[a].lessons.length; b++) {
        if (a === mi && b === li) break outer;
        const L = COURSE[a].lessons[b];
        if (L.setup) L.setup(S);
        for (const ms of L.missions) { Sim.exec(S, ms.answer); if (S.pending) Sim.exec(S, "y"); }
      }
    }
    S.history = [];
    return S;
  }

  function resetAll() {
    if (!confirm("Reset all progress and the practice terminal?")) return;
    state.done = {};
    state.sim = Sim.createState();
    go({ screen: "home" });
    updateTop();
  }

  // ------------------------------------------------------------ LESSON
  let term = null; // live terminal controller for the current lesson
  let activeSim = null; // sandbox the terminal is talking to (own or replay)

  function renderLesson() {
    let { mi, li } = state.view;
    if (!COURSE[mi] || !COURSE[mi].lessons[li] || !lessonUnlocked(mi, li)) {
      const s = nextStop();
      if (!s) return go({ screen: "home" });
      mi = s.mi; li = s.li;
      state.view = { screen: "lesson", mi, li };
    }
    const m = COURSE[mi], l = m.lessons[li];
    if (l.setup && !lessonDone(m, l)) { l.setup(state.sim); save(); }

    // Replay mode: practise a finished lesson again in a throwaway sandbox.
    let replay = null; // { sim, done: Set<number> }
    const sim = () => (replay ? replay.sim : state.sim);
    activeSim = state.sim;
    const isDone = (i) => (replay ? replay.done.has(i) : !!state.done[mid(m, l, i)]);
    const curIdx = () => l.missions.findIndex((_, i) => !isDone(i));

    const info = h("aside", { class: `info c-${m.color}` });
    const side = h("section", { class: "work" });
    const layout = h("div", { class: "lesson-layout" }, side, info);
    app.replaceChildren(layout);

    // ----- info column
    const stepper = h("div", { class: "lesson-steps", "aria-label": "Lessons in this module" },
      ...m.lessons.map((x, i) => {
        const ok = lessonUnlocked(mi, i);
        return h("button", {
          type: "button", class: `step ${i === li ? "on" : ""} ${lessonDone(m, x) ? "done" : ""}`,
          disabled: !ok, title: ok ? x.title : "Locked", onclick: ok ? () => go({ screen: "lesson", mi, li: i }) : null,
        }, lessonDone(m, x) ? icon.check() : !ok ? icon.lock() : String(i + 1));
      }));

    const missionList = h("ol", { class: "mlist" });
    info.append(
      h("button", { class: "back", type: "button", onclick: () => go({ screen: "module", mi }) }, icon.back(), `Module ${mi + 1} overview`),
      h("div", { class: "info-head" },
        h("span", { class: "mod-chip" }, `Module ${mi + 1} · ${m.title}`),
        stepper),
      h("p", { class: "lesson-count" }, `Lesson ${li + 1} of ${m.lessons.length}`),
      h("h1", { class: "lesson-title" }, l.title),
      h("p", { class: "read", html: l.read }),
      h("div", { class: "terms" }, ...l.terms.map(([t, d]) => h("div", { class: "kterm" }, h("code", {}, t), h("span", {}, d)))),
      h("h2", { class: "sub" }, "Missions"),
      missionList,
      h("h2", { class: "sub" }, icon.book(), "Go deeper"),
      h("ul", { class: "docs" }, ...l.docs.map(([t, u]) => h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener" }, t, icon.ext()))))
    );

    // ----- work column: mission card + terminal
    const card = h("div", { class: `mission c-${m.color}` });
    const termEl = h("div", { class: "term" });
    side.append(card, termEl);

    term = createTerminal(termEl, onCommand);
    term.print([{ t: `Lesson: ${l.title}. Type "help" any time, "clear" to wipe the screen.`, c: "dim" }]);

    function paintMissions() {
      const cur = curIdx();
      missionList.replaceChildren(...l.missions.map((ms, i) => {
        const d = isDone(i);
        const isCur = i === cur;
        return h("li", { class: `${d ? "done" : ""} ${isCur ? "cur" : ""} ${!d && !isCur ? "later" : ""}` },
          h("span", { class: "mdot" }, d ? icon.check() : String(i + 1)),
          h("span", { class: "mtext", html: !d && !isCur ? "Locked until the one above is done" : ms.goal }));
      }));
    }

    function startReplay() {
      replay = { sim: sandboxBefore(mi, li), done: new Set() };
      if (l.setup) l.setup(replay.sim);
      replay.sim.history = [];
      activeSim = replay.sim;
      term.clear();
      term.print([{ t: `Replay: "${l.title}" in a fresh practice sandbox. Your saved progress is untouched.`, c: "note" }]);
      term.setPrompt(Sim.prompt(replay.sim));
      term.setHistory(replay.sim.history);
      card.classList.remove("complete");
      paintCard(false);
      paintMissions();
      term.focus();
    }
    function stopReplay() {
      replay = null;
      activeSim = state.sim;
      term.clear();
      term.print([{ t: "Back to your own sandbox.", c: "dim" }]);
      term.setPrompt(Sim.prompt(state.sim));
      term.setHistory(state.sim.history);
      paintCard(false);
      paintMissions();
    }

    function paintCard(flash) {
      const cur = curIdx();
      card.classList.toggle("flash", !!flash);
      card.classList.toggle("replaying", !!replay);
      if (cur === -1) return paintComplete();
      card.classList.remove("complete");
      const ms = l.missions[cur];
      const hint = h("p", { class: "hint", hidden: true }, "💡 ", ms.hint);
      const answer = h("p", { class: "answer", hidden: true }, h("span", {}, "Type this:"), h("code", {}, ms.answer));
      card.replaceChildren(
        h("div", { class: "mission-top" },
          h("span", { class: "mission-label" }, `${replay ? "Replay · " : ""}Mission ${cur + 1}/${l.missions.length}`),
          h("div", { class: "pips" }, ...l.missions.map((_, i) => h("i", { class: isDone(i) ? "on" : i === cur ? "cur" : "" })))),
        h("p", { class: "goal", html: ms.goal }),
        h("div", { class: "mission-actions" },
          h("button", { class: "ghost", type: "button", onclick: (e) => { hint.hidden = false; e.currentTarget.disabled = true; term.focus(); } }, "Hint"),
          h("button", { class: "ghost", type: "button", onclick: (e) => { hint.hidden = false; answer.hidden = false; e.currentTarget.disabled = true; term.focus(); } }, "Show answer"),
          replay ? h("button", { class: "ghost push", type: "button", onclick: stopReplay }, "Stop replay") : null),
        hint, answer);
      if (flash) setTimeout(() => card.classList.remove("flash"), 900);
    }

    function paintComplete() {
      const lastLesson = li === m.lessons.length - 1;
      const lastModule = mi === COURSE.length - 1;
      let next, label, small;
      if (!lastLesson) { next = { screen: "lesson", mi, li: li + 1 }; label = "Next lesson"; small = m.lessons[li + 1].title; }
      else if (!lastModule) { next = { screen: "lesson", mi: mi + 1, li: 0 }; label = "Module unlocked"; small = COURSE[mi + 1].title; }
      else { next = { screen: "home" }; label = "You finished the course"; small = "Back to the yard"; }
      card.classList.add("complete");
      const replayed = !!replay;
      card.replaceChildren(
        h("div", { class: "complete-badge" }, icon.check()),
        h("div", { class: "complete-copy" },
          h("p", { class: "mission-label" }, replayed ? "Replay complete" : lastLesson ? `Module ${mi + 1} complete` : "Lesson complete"),
          h("p", { class: "goal" }, replayed ? "Same commands, second time round. That's how it sticks." : lastLesson ? (lastModule ? "That's everything. You can now run, build, ship and orchestrate containers." : `Nice. “${COURSE[mi + 1].title}” is open.`) : "All missions done. Keep playing in the terminal, or move on."),
          h("div", { class: "complete-actions" },
            h("button", { class: "cta small", type: "button", onclick: () => go(next) }, h("span", {}, label), h("small", {}, small), icon.arrow()),
            h("button", { class: "ghost", type: "button", onclick: startReplay }, icon.reset(), replayed ? "Replay again" : "Replay missions"),
            replayed ? h("button", { class: "ghost", type: "button", onclick: stopReplay }, "Back to my sandbox") : null)));
    }

    function onCommand(line) {
      const S = sim();
      const r = Sim.exec(S, line);
      if (r.clear) { term.clear(); if (!replay) save(); return; }
      term.print(r.lines);
      const cur = curIdx();
      if (cur !== -1) {
        let pass = false;
        try { pass = !!l.missions[cur].check(r, S); } catch { pass = false; }
        if (pass) {
          if (replay) replay.done.add(cur);
          else state.done[mid(m, l, cur)] = true;
          const nextCur = curIdx();
          term.print([{ t: nextCur === -1 ? (replay ? "✓ Replay complete!" : "✓ Mission complete. Lesson done!") : `✓ Mission complete. Next: mission ${nextCur + 1}`, c: "win" }]);
          paintCard(true);
          paintMissions();
          updateTop();
        }
      }
      term.setPrompt(Sim.prompt(S));
      if (!replay) save();
    }

    term.setPrompt(Sim.prompt(state.sim));
    term.setHistory(state.sim.history);
    paintCard(false);
    paintMissions();
    term.focus();
  }

  // ------------------------------------------------------------ terminal widget
  const COMPLETE = ["docker", "kubectl", "kind", "compose", "run", "ps", "images", "pull", "push", "build", "logs", "exec", "stop", "start", "restart", "volume", "network", "system", "prune", "create", "inspect", "login", "tag", "rmi", "rm", "get", "pods", "nodes", "deployment", "describe", "delete", "expose", "scale", "rollout", "status", "undo", "cluster", "ssh", "exit", "clear", "help", "history", "Dockerfile", "compose.yaml", "--name", "--network", "--replicas=", "--image=", "--port="];

  function createTerminal(root, onEnter) {
    const out = h("div", { class: "term-out", role: "log", "aria-live": "polite" });
    const user = h("span", { class: "p-user" });
    const path = h("span", { class: "p-path" });
    const input = h("input", { class: "term-input", type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Terminal input", enterkeyhint: "send" });
    const hostLabel = h("em", {});
    root.append(
      h("div", { class: "term-bar" }, h("span", { class: "dot" }), h("span", { class: "dot" }), h("span", { class: "dot" }), hostLabel,
        h("button", { class: "term-reset", type: "button", title: "Clear screen", onclick: () => { out.replaceChildren(); input.focus(); } }, "clear")),
      h("div", { class: "term-screen", onclick: (e) => { if (!window.getSelection().toString() && e.target.tagName !== "A") input.focus(); } },
        out,
        h("label", { class: "term-line" }, h("span", { class: "prompt" }, user, ":", path, "$ "), input)));
    const screen = root.querySelector(".term-screen");

    let hist = [], hi = 0, draft = "";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value;
        echo(v);
        input.value = "";
        hi = hist.length + (v.trim() ? 1 : 0);
        if (v.trim()) onEnter(v);
        hi = hist.length;
        scroll();
      } else if (e.key === "ArrowUp") {
        if (!hist.length) return;
        if (hi === hist.length) draft = input.value;
        hi = Math.max(0, hi - 1);
        input.value = hist[hi] || "";
        e.preventDefault();
        requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
      } else if (e.key === "ArrowDown") {
        if (hi >= hist.length) return;
        hi += 1;
        input.value = hi === hist.length ? draft : hist[hi];
        e.preventDefault();
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        out.replaceChildren();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const parts = input.value.split(" ");
        const word = parts.pop();
        if (!word) return;
        const names = [];
        try { for (const c of Sim.engine(activeSim || state.sim).containers) names.push(c.name); } catch { /* ignore */ }
        const hits = [...new Set([...COMPLETE, ...names])].filter((w) => w.startsWith(word));
        if (hits.length === 1) input.value = [...parts, hits[0]].join(" ") + (hits[0].endsWith("=") ? "" : " ");
        else if (hits.length > 1) print([{ t: hits.join("   "), c: "dim" }]);
      } else if (e.key === "c" && e.ctrlKey && !window.getSelection().toString()) {
        echo(input.value + "^C");
        input.value = "";
      }
    });

    function echo(v) {
      out.append(h("div", { class: "ln cmdline" }, h("span", { class: "prompt" }, h("span", { class: "p-user" }, user.textContent), ":", h("span", { class: "p-path" }, path.textContent), "$ "), v));
    }
    function print(lines) {
      const frag = document.createDocumentFragment();
      for (const l of lines) frag.append(h("div", { class: "ln " + (l.c || "") }, l.t || " "));
      out.append(frag);
      scroll();
    }
    function scroll() { screen.scrollTop = screen.scrollHeight; }
    return {
      print,
      clear() { out.replaceChildren(); },
      focus() { if (matchMedia("(pointer: fine)").matches) input.focus({ preventScroll: true }); },
      setPrompt(p) { user.textContent = p.user; path.textContent = p.path; hostLabel.textContent = `${p.user}: ${p.path}`; root.classList.toggle("remote", p.user.startsWith("deploy")); },
      setHistory(arr) { hist = arr; hi = arr.length; },
    };
  }

  // ------------------------------------------------------------ boot
  function render() {
    updateTop();
    document.body.dataset.screen = state.view.screen;
    if (state.view.screen === "lesson") renderLesson();
    else if (state.view.screen === "module") renderModule();
    else renderHome();
  }
  render();
})();
