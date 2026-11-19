/* Ask HarperLinks — the floating assistant.
   Lives on every page, remembers where you drag it, and opens a small chat
   that streams its real thinking (same /api/chat/stream the Command Centre
   uses, so it can genuinely do work, not just answer questions). */
(function () {
  "use strict";
  var HL = window.HL;
  var POS_KEY = "hl-fab-pos";

  HL.mountAssistant = function () {
    if (document.getElementById("hlFab")) return;

    /* ---------- the bubble ---------- */
    var fab = HL.el("button", "hl-fab");
    fab.id = "hlFab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Ask HarperLinks");

    /* The mascot: a pixel robot drawn cell-by-cell from this map, so it stays
       crisp at any size and we can animate parts (arm wave, cursor blink).
       B blue · L highlight · D shade · S screen · C cyan · U blinking cursor */
    var ART = [
      "..........BBBBBBBB..........",
      "........BBBBBBBBBBBB........",
      "....BLLBBBBBBBBBBBBBBBB.....",
      "...BLBBBBBBBBBBBBBBBBBBB....",
      ".BBBBBBBBBBBBBBBBBBBBBBBBB..",
      "BLLBBBBBSSSSSSSSSSSSBBBBBBBB",
      "BBBBBBBBSSCCSSSSSSSSBBBBBBBB",
      "BBBBBBBBSSSCCSSSSSSSBBBBBBBB",
      "BBBBBBBBSSSSCCSSSSSSBBBBBBBB",
      "BBBBBBBBSSSCCSSSSSSSBBBBBBBB",
      "BBBBBBBBSSCCSSSUUUSSBBBBBBBB",
      "BBBBBBBBSSSSSSSSSSSSBBBBBBBB",
      ".BBBBBBBBBBBBBBBBBBBBBBBBBB.",
      ".BBBBBBBBBBBBBBBBBBBBBBBBBB.",
      "..DDDDDDDDDDDDDDDDDDDDDDDD..",
      "...DDDDDD..DDDDDD..DDDDDD...",
      "............BBBB............",
      "..........BBBBBBBB..........",
      "......BBBBBBBBBBBBBBBB......",
      ".....BBB.BBSSSSSSBB.BBB.....",
      ".....BBB.BBSCCSCSBB.BBB.....",
      ".....BBB.BBSSSSSSBB.BBB.....",
      "......BB.BBBBBBBBBB.BB......",
      ".........BBBBBBBBBB.........",
      ".........BBBBBBBBBB.........",
      ".........DBBBBBBBBD.........",
      "..........BBB..BBB..........",
      "..........BBB..BBB..........",
      ".........BBBB..BBBB.........",
      ".........DDDD..DDDD........."
    ];
    var INK = { B: "#4D7CF0", L: "#8FB2F8", D: "#3B5ED1", S: "#101831", C: "#5FE9F7", U: "#5FE9F7" };
    function botSVG() {
      var body = "", arm = "";
      ART.forEach(function (row, y) {
        for (var x = 0; x < row.length; x++) {
          var ch = row[x];
          if (ch === ".") continue;
          var cls = ch === "U" ? ' class="px-u"' : ch === "C" ? ' class="px-c"' : "";
          var r = '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + INK[ch] + '"' + cls + "/>";
          // the right arm waves on hover, so it lives in its own group
          if (y >= 18 && y <= 22 && x >= 19) arm += r; else body += r;
        }
      });
      return '<svg class="px-bot" viewBox="0 0 28 30" shape-rendering="crispEdges" aria-hidden="true">' +
        '<g>' + body + '</g><g class="px-arm">' + arm + "</g></svg>";
    }
    fab.innerHTML = '<span class="px-wrap">' + botSVG() + "</span>" + '<span class="fab-tip">Ask HarperLinks</span>';
    document.body.appendChild(fab);

    /* ---------- the panel ---------- */
    var panel = HL.el("div", "hl-apanel");
    panel.id = "hlAPanel";
    panel.innerHTML =
      '<div class="ap-head">' +
        '<span class="ap-title"><span class="ap-spark">✦</span> Ask HarperLinks</span>' +
        '<button class="ap-x" type="button" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="ap-msgs" id="apMsgs"></div>' +
      '<form class="ap-form"><input type="text" placeholder="Ask, or tell me to do something…" maxlength="500" autocomplete="off" /><button type="submit" aria-label="Send">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
      "</button></form>";
    document.body.appendChild(panel);

    var msgs = panel.querySelector(".ap-msgs");
    var form = panel.querySelector(".ap-form");
    var input = panel.querySelector(".ap-form input");

    /* ---------- position: restore, drag, remember ---------- */
    function clamp(x, y) {
      var w = fab.offsetWidth || 58, h = fab.offsetHeight || 58;
      return {
        x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
        y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)),
      };
    }
    function place(x, y) {
      var p = clamp(x, y);
      fab.style.left = p.x + "px";
      fab.style.top = p.y + "px";
      fab.style.right = "auto";
      fab.style.bottom = "auto";
      // panel opens on whichever side has room
      var leftHalf = p.x < window.innerWidth / 2;
      panel.classList.toggle("flip", leftHalf);
      var px = leftHalf ? p.x : Math.max(8, p.x + fab.offsetWidth - panel.offsetWidth);
      var below = p.y < window.innerHeight / 2;
      panel.style.left = Math.min(px, Math.max(8, window.innerWidth - panel.offsetWidth - 8)) + "px";
      panel.style.top = below ? (p.y + fab.offsetHeight + 12) + "px"
                              : Math.max(8, p.y - panel.offsetHeight - 12) + "px";
      return p;
    }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (e) { /* ignore */ }
    var start = saved || { x: window.innerWidth - 86, y: window.innerHeight - 96 };
    place(start.x, start.y);

    /* ---------- drag, and THROW ----------
       Release above the throw speed and he goes flying: gravity, wall
       bounces with a squash, spin from his horizontal speed, a dizzy
       wobble when he lands. Grab him mid-air to catch him. */
    var wrap = fab.querySelector(".px-wrap");
    var drag = null, flight = null;
    var calmMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function savePos() {
      var p = clamp(fab.offsetLeft, fab.offsetTop);
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
    }
    function impact() {
      fab.classList.remove("impact");
      void fab.offsetWidth;
      fab.classList.add("impact");
      setTimeout(function () { fab.classList.remove("impact"); }, 200);
    }
    // Commit wherever he is right now to real coordinates, then drop the
    // flight transform — one frame, no jump. Without this a mid-air catch
    // would teleport him back to where the throw began.
    // Commit a position and drop the flight transform in ONE visual frame.
    // The button has `transition: transform`, so clearing the transform
    // without suppressing it would GLIDE him back over 250ms — that was a
    // real bug: a mid-air catch sent him swooshing 100px+ from your hand.
    function commitAt(px, py) {
      fab.style.transition = "none";
      fab.style.left = px + "px";
      fab.style.top = py + "px";
      fab.style.transform = "";
      void fab.offsetWidth; // apply before the transition comes back
      fab.style.transition = "";
    }
    function stopFlight() {
      if (!flight) return;
      cancelAnimationFrame(flight.raf);
      commitAt(flight.px, flight.py);
      flight = null;
      fab.classList.remove("flying");
      wrap.classList.remove("easeback");
      wrap.style.transform = "";
    }
    function settleFlight() {
      var px = flight.px, py = flight.py;
      cancelAnimationFrame(flight.raf);
      flight = null;
      commitAt(px, py);
      fab.classList.remove("flying");
      // ease his tilt back upright, THEN the dizzy wobble — no snap
      wrap.classList.add("easeback");
      wrap.style.transform = "rotate(0deg)";
      setTimeout(function () {
        wrap.classList.remove("easeback");
        wrap.style.transform = "";
        fab.classList.add("dizzy");
        setTimeout(function () { fab.classList.remove("dizzy"); }, 650);
      }, 300);
      place(px, py);
      savePos();
    }

    function startThrow(vx, vy) {
      if (panel.classList.contains("open")) {
        panel.classList.remove("open");
        fab.classList.remove("active");
      }
      fab.classList.add("flying");
      // freeze the origin; every frame moves a GPU transform, not layout
      var ox = fab.offsetLeft, oy = fab.offsetTop;
      var px = ox, py = oy, rot = 0;
      var G = 2600, BOUNCE = 0.55, DRAG = 0.1, started = performance.now(), last = started;
      var sp = Math.hypot(vx, vy), MAX = 3200;
      if (sp > MAX) { vx *= MAX / sp; vy *= MAX / sp; }

      function frame(now) {
        var dt = Math.min(0.03, (now - last) / 1000);
        last = now;
        var w = fab.offsetWidth, h = fab.offsetHeight;
        var minX = 8, maxX = window.innerWidth - w - 8;
        var minY = 8, floorY = window.innerHeight - h - 8;

        vy += G * dt;
        vx *= Math.max(0, 1 - DRAG * dt); // a touch of air drag
        px += vx * dt;
        py += vy * dt;

        if (px < minX) { px = minX; vx = -vx * BOUNCE; impact(); }
        if (px > maxX) { px = maxX; vx = -vx * BOUNCE; impact(); }
        if (py < minY) { py = minY; vy = -vy * BOUNCE; impact(); }
        var onFloor = false;
        if (py >= floorY) {
          py = floorY;
          onFloor = true;
          if (vy > 180) { vy = -vy * BOUNCE; vx *= 0.85; impact(); }
          else { vy = 0; }
          vx *= Math.max(0, 1 - 5 * dt);
        }

        rot += vx * dt * 0.3;
        flight.px = px; flight.py = py;
        fab.style.transform = "translate3d(" + (px - ox) + "px," + (py - oy) + "px,0)";
        wrap.style.transform = "rotate(" + rot.toFixed(2) + "deg)";

        var done = onFloor && vy === 0 && Math.abs(vx) < 24;
        if (done || now - started > 7000) { settleFlight(); return; }
        flight.raf = requestAnimationFrame(frame);
      }
      flight = { raf: requestAnimationFrame(frame), px: px, py: py };
    }

    fab.addEventListener("pointerdown", function (ev) {
      var caught = !!flight;
      stopFlight(); // catching him mid-air
      drag = {
        dx: ev.clientX - fab.offsetLeft,
        dy: ev.clientY - fab.offsetTop,
        moved: caught,       // a catch is a drag, never a click
        trail: [],
      };
      fab.setPointerCapture(ev.pointerId);
      fab.classList.add("dragging");
    });
    fab.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var nx = ev.clientX - drag.dx, ny = ev.clientY - drag.dy;
      if (Math.abs(nx - fab.offsetLeft) > 2 || Math.abs(ny - fab.offsetTop) > 2) drag.moved = true;
      drag.trail.push({ x: nx, y: ny, t: performance.now() });
      if (drag.trail.length > 8) drag.trail.shift();
      place(nx, ny);
    });
    function endDrag(ev) {
      if (!drag) return;
      fab.classList.remove("dragging");
      try { fab.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }

      // velocity from the last ~100ms of movement
      var vx = 0, vy = 0;
      var trail = drag.trail, now = performance.now();
      var old = null;
      for (var i = 0; i < trail.length; i++) { if (now - trail[i].t <= 110) { old = trail[i]; break; } }
      var cur = trail[trail.length - 1];
      if (old && cur && cur.t > old.t) {
        vx = (cur.x - old.x) / (cur.t - old.t) * 1000;
        vy = (cur.y - old.y) / (cur.t - old.t) * 1000;
      }
      var wasDrag = drag.moved;
      drag = null;

      if (!wasDrag) { savePos(); toggle(); return; }       // a click
      if (!calmMotion && Math.hypot(vx, vy) > 620) {        // a throw
        startThrow(vx, vy);
        return;
      }
      savePos();                                            // a gentle place
    }
    fab.addEventListener("pointerup", endDrag);
    fab.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", function () { if (!flight) place(fab.offsetLeft, fab.offsetTop); });

    /* ---------- open / close ---------- */
    var greeted = false;
    function toggle() {
      var opening = !panel.classList.contains("open");
      if (opening) {
        place(fab.offsetLeft, fab.offsetTop);
        panel.classList.add("open");
        fab.classList.add("active");
        if (!greeted) {
          greeted = true;
          add("bot", "I'm right here. Ask me anything, or tell me to do something — write posts, build an automation, change your website.");
        }
        setTimeout(function () { input.focus(); }, 180);
      } else {
        panel.classList.remove("open");
        fab.classList.remove("active");
      }
    }
    panel.querySelector(".ap-x").addEventListener("click", toggle);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("open")) toggle();
    });

    /* ---------- messages ---------- */
    function add(kind, text) {
      var el = HL.el("div", "ap-m " + kind);
      el.textContent = text;
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
      return el;
    }

    // a live thinking block, same honesty rules as the main chat: a row only
    // appears because the server said that step really started
    function thinkBlock() {
      var box = HL.el("div", "ap-think");
      var head = HL.el("div", "ap-think-head");
      head.innerHTML = '<span class="ap-dots"><i></i><i></i><i></i></span><span class="apt-label">Thinking…</span>';
      box.appendChild(head);
      var list = HL.el("div", "ap-think-list");
      box.appendChild(list);
      msgs.appendChild(box);
      msgs.scrollTop = msgs.scrollHeight;
      var waiting = {}, done = 0;
      function label(t) { return (HL.STEP_LABELS && HL.STEP_LABELS[t]) || t; }
      return {
        say: function (t) { head.querySelector(".apt-label").textContent = t; },
        start: function (tool) {
          var r = HL.el("div", "ap-step pending");
          r.innerHTML = '<span class="ap-spin"></span><span>' + HL.esc(label(tool)) + "</span>";
          list.appendChild(r);
          (waiting[tool] = waiting[tool] || []).push(r);
          msgs.scrollTop = msgs.scrollHeight;
        },
        finish: function (tool, ok) {
          var r = (waiting[tool] || []).shift();
          if (!r) { r = HL.el("div", "ap-step"); list.appendChild(r); }
          r.className = "ap-step";
          r.innerHTML = (ok ? '<span class="ap-ok">✓</span>' : '<span class="ap-bad">!</span>') +
            "<span>" + HL.esc(label(tool)) + "</span>";
          done++;
          msgs.scrollTop = msgs.scrollHeight;
        },
        done: function () {
          box.classList.add("settled");
          head.querySelector(".ap-dots").remove();
          head.querySelector(".apt-label").textContent = done ? "Did " + done + " step" + (done > 1 ? "s" : "") : "Thought it through";
        },
        drop: function () { box.remove(); },
      };
    }

    var busy = false;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      form.classList.add("sending");
      add("user", text);
      input.value = "";
      setTimeout(function () { form.classList.remove("sending"); }, 400);

      var think = thinkBlock();
      var settled = false;
      var payload = { sessionId: "fab-" + HL.sessionId, message: text };

      function land(out) {
        settled = true;
        think.done();
        if (out.reply) add("bot", out.reply);
        busy = false;
        input.focus();
        // work may have changed the page behind us
        if ((out.actions || []).length) HL.navigate();
      }
      function fail(msg) {
        settled = true;
        think.drop();
        add("bot", "Sorry — " + msg);
        busy = false;
        input.focus();
      }

      HL.stream("/api/chat/stream", payload, function (ev) {
        if (ev.phase === "model") think.say("Thinking…");
        else if (ev.phase === "tool-start") { think.say("Working…"); think.start(ev.tool); }
        else if (ev.phase === "step") think.finish(ev.tool, ev.ok);
        else if (ev.phase === "done") land(ev);
        else if (ev.phase === "error") fail(ev.error);
      }).then(function () {
        if (!settled) fail("the connection dropped mid-answer.");
      }).catch(function () {
        if (settled) return;
        think.drop();
        HL.post("/api/chat", payload).then(land).catch(function (err) { fail(err.message); });
      });
    });
  };
})();
