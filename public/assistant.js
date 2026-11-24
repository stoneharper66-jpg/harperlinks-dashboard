/* Ask HarperLinks — the floating assistant.
   Lives on every page, remembers where you drag it, and opens a small chat
   that streams its real thinking (same /api/chat/stream the Command Centre
   uses, so it can genuinely do work, not just answer questions). */
(function () {
  "use strict";
  var HL = window.HL;
  var POS_KEY = "hl-fab-pos";

  var ART = [
    "............PPPP............",
    "............PPPP............",
    ".............BB.............",
    "....BBBBBBBBBBBBBBBBBBBB....",
    "...BLLBBBBBBBBBBBBBBBBBBB...",
    "..BLBBSSSSSSSSSSSSSSSSBBBB..",
    "PPBBBBSSSCCSSSSSSSSSSSBBBBPP",
    "PPBBBBSSSSCCSSSSSSSSSSBBBBPP",
    "PPBBBBSSSSSCCSSSSSSSSSBBBBPP",
    "PPBBBBSSSSCCSSSSSSSSSSBBBBPP",
    "..BBBBSSSCCSSSSUUUSSSSBBBB..",
    "..BBBBBBBBBBBBBBBBBBBBBBBB..",
    "...BBBBBBBBBBBBBBBBBBBBBB...",
    "....DDDDDDDDDDDDDDDDDDDD....",
    "............BBBB............",
    "........BBBBBBBBBBBB........",
    ".....BBBBBBBBBBBBBBBBBB.....",
    ".....BBB.BBBPPPPBBB.BBB.....",
    ".....BBB.BBBPPPPBBB.BBB.....",
    ".....BBB.BBBPPPPBBB.BBB.....",
    "......BB.BBBBBBBBBB.BB......",
    ".........BBBBBBBBBB.........",
    ".........BBBBBBBBBB.........",
    ".........DBBBBBBBBD.........",
    "..........BBB..BBB..........",
    "..........BBB..BBB..........",
    ".........BBBB..BBBB.........",
    ".........DDDD..DDDD........."
  ];

  var INK = { B: "#5B4BE8", L: "#9A90F5", D: "#3E2FC7", S: "#0E1430", C: "#5FE9F7", U: "#5FE9F7", P: "#E84393" };

  // One pixel body, many coats of paint — the AI Employees page uses this
  // to give every employee their own face in their own colour.
  var TEAM_PAL = {
    social:      { B: "#E84393", L: "#F27DB8", D: "#BE2A72", P: "#3E7BEA" }, // Sage
    sales:       { B: "#F59E0B", L: "#FBC55A", D: "#C57F07", P: "#E84393" }, // Flynn
    receptionist:{ B: "#14B8A6", L: "#5BD6C6", D: "#0E8A7B", P: "#E84393" }, // Harper
    manager:     { B: "#8B5CF6", L: "#B39BF8", D: "#6A3ED2", P: "#E84393" }, // Darcy
    support:     { B: "#0EA5E9", L: "#67CDF5", D: "#0777AE", P: "#E84393" }, // Riley
    web:         { B: "#EF4444", L: "#F79090", D: "#BE2626", P: "#3E7BEA" }, // Indi
  };
  HL.botFace = function (id) {
    var ink = Object.assign({}, INK, TEAM_PAL[id] || {});
    var out = "";
    ART.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var ch = row[x];
        if (ch === ".") continue;
        out += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + ink[ch] + '"/>';
      }
    });
    return '<svg viewBox="0 0 28 28" shape-rendering="crispEdges" aria-hidden="true">' + out + "</svg>";
  };


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

    function botSVG() {
      var body = "", arm = "", face = "";
      ART.forEach(function (row, y) {
        for (var x = 0; x < row.length; x++) {
          var ch = row[x];
          if (ch === ".") continue;
          var cls = ch === "U" ? ' class="px-u"' : ch === "C" ? ' class="px-c"' : "";
          var r = '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + INK[ch] + '"' + cls + "/>";
          if (y >= 17 && y <= 20 && x >= 20) arm += r;                 // waving arm
          else if ((ch === "C" || ch === "U") && y <= 11) face += r;   // the normal face
          else body += r;
        }
      });
      // the OUCH face: X X eyes and a flat little mouth, shown on impacts
      var hurt = "";
      [[6,9],[6,11],[7,10],[8,9],[8,11],  [6,14],[6,16],[7,15],[8,14],[8,16],
       [10,11],[10,12],[10,13],[10,14]].forEach(function (c) {
        hurt += '<rect x="' + c[1] + '" y="' + c[0] + '" width="1" height="1" fill="#FF6B81"/>';
      });
      return '<svg class="px-bot" viewBox="0 0 28 28" shape-rendering="crispEdges" aria-hidden="true">' +
        '<g>' + body + '</g><g class="face-normal">' + face + '</g><g class="face-hurt">' + hurt + '</g><g class="px-arm">' + arm + "</g></svg>";
    }
    fab.innerHTML = '<span class="px-wrap">' + botSVG() + "</span>" + '<span class="fab-tip">Ask HarperLinks</span>';
    document.body.appendChild(fab);

    /* ---------- the panel ---------- */
    // a tiny version of him for the header and beside his messages
    function miniBot(px) {
      return '<span class="ap-av" style="width:' + px + 'px;height:' + (px * 30 / 28).toFixed(0) + 'px">' + botSVG() + "</span>";
    }
    var panel = HL.el("div", "hl-apanel");
    panel.id = "hlAPanel";
    panel.innerHTML =
      '<div class="ap-head">' +
        miniBot(26) +
        '<span class="ap-who"><span class="ap-title">HarperLinks Assistant</span>' +
        '<span class="ap-sub"><i class="ap-on"></i>online · does real work</span></span>' +
        '<button class="ap-x" type="button" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="ap-msgs" id="apMsgs"></div>' +
      '<div class="ap-chips">' +
        '<button type="button">Write 3 posts for this week</button>' +
        '<button type="button">What\'s my day look like?</button>' +
        '<button type="button">Build me an automation</button>' +
      "</div>" +
      '<form class="ap-form"><input type="text" placeholder="Ask, or tell me to do something…" maxlength="500" autocomplete="off" /><button type="submit" aria-label="Send">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
      "</button></form>";
    document.body.appendChild(panel);

    var msgs = panel.querySelector(".ap-msgs");
    var form = panel.querySelector(".ap-form");
    var input = panel.querySelector(".ap-form input");
    var chips = panel.querySelector(".ap-chips");
    chips.querySelectorAll("button").forEach(function (c) {
      c.addEventListener("click", function () {
        input.value = c.textContent;
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    });

    /* ---------- position: restore, drag, remember ---------- */
    function clamp(x, y) {
      var w = fab.offsetWidth || 58, h = fab.offsetHeight || 58;
      return {
        x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
        y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)),
      };
    }
    // Put the panel beside him, always fully on screen: it takes whichever
    // side has more room and is told how tall it may be, so it can never be
    // cut off at the top or bottom of the window.
    function placePanel(p) {
      var fw = fab.offsetWidth || 58, fh = fab.offsetHeight || 68, GAP = 12, EDGE = 8;
      var leftHalf = p.x < window.innerWidth / 2;
      panel.classList.toggle("flip", leftHalf);
      var pw = panel.offsetWidth || 370;
      var px = leftHalf ? p.x : (p.x + fw - pw);
      panel.style.left = Math.min(Math.max(EDGE, px), Math.max(EDGE, window.innerWidth - pw - EDGE)) + "px";

      var roomBelow = window.innerHeight - (p.y + fh) - GAP - EDGE;
      var roomAbove = p.y - GAP - EDGE;
      var below = roomBelow >= roomAbove;
      panel.style.maxHeight = Math.max(220, Math.min(500, below ? roomBelow : roomAbove)) + "px";
      var ph = panel.offsetHeight || 320;
      var top = below ? (p.y + fh + GAP) : (p.y - ph - GAP);
      panel.style.top = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - ph - EDGE)) + "px";
    }
    function place(x, y) {
      var p = clamp(x, y);
      fab.style.left = p.x + "px";
      fab.style.top = p.y + "px";
      fab.style.right = "auto";
      fab.style.bottom = "auto";
      // Measuring the panel forces a layout. Doing that on every pointer move
      // while he's being dragged is what made this feel sticky — so only do
      // it when the panel is actually open.
      if (panel.classList.contains("open")) placePanel(p);
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
      hurtFace(450);
      say("hit");
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
        hurtFace(700);
        say("land", true);
        setTimeout(function () { fab.classList.remove("dizzy"); }, 650);
      }, 300);
      place(px, py);
      savePos();
    }

    /* ---- he has feelings ----
       Short speech bubbles that float up from wherever he is, and an ouch
       face that flashes on when he hits something. */
    var LINES = {
      throw_: ["WHEEE!", "aaaAAAH!", "not again!!", "I regret nothing!", "airborne!!"],
      hit: ["ow!", "oof!", "my pixels!!", "bonk", "ouch.", "that's a wall!"],
      land: ["...where am I?", "I'm fine. totally fine.", "rude.", "again! again!", "ow. just... ow."],
      pickup: ["hm?", "where we going?", "easy now…", "wait wait wait—"],
    };
    var lastSay = 0;
    function say(kind, force) {
      var now = Date.now();
      if (!force && now - lastSay < 600) return; // don't gabble
      lastSay = now;
      var pool = LINES[kind] || [];
      if (!pool.length) return;
      var b = document.createElement("div");
      b.className = "px-say";
      b.textContent = pool[(Math.random() * pool.length) | 0];
      document.body.appendChild(b);
      var r = fab.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top - 8;
      b.animate([
        { transform: "translate(-50%,0) translate(" + cx + "px," + cy + "px) scale(.6)", opacity: 0 },
        { transform: "translate(-50%,-12px) translate(" + cx + "px," + cy + "px) scale(1)", opacity: 1, offset: 0.18 },
        { transform: "translate(-50%,-30px) translate(" + cx + "px," + cy + "px) scale(1)", opacity: 1, offset: 0.75 },
        { transform: "translate(-50%,-46px) translate(" + cx + "px," + cy + "px) scale(.92)", opacity: 0 }
      ], { duration: 1150, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = function () { b.remove(); };
    }
    var botEl = null;
    function hurtFace(ms) {
      botEl = botEl || fab.querySelector(".px-bot");
      botEl.classList.add("hurt");
      clearTimeout(hurtFace._t);
      hurtFace._t = setTimeout(function () { botEl.classList.remove("hurt"); }, ms || 500);
    }

    /* ---- pixel dust ----
       Particles are driven by the Web Animations API, so the compositor
       animates them off the main thread — the trail costs the flight loop
       nothing. Little squares, to match the pixel art. */
    var dustLayer = null;
    var DUST_INKS = ["#4D7CF0", "#8FB2F8", "#5FE9F7", "#D81B72"];
    function dust(cx, cy, dvx, dvy, n, spread) {
      if (!dustLayer) {
        dustLayer = document.createElement("div");
        dustLayer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1198;overflow:hidden";
        document.body.appendChild(dustLayer);
      }
      if (dustLayer.childElementCount > 70) return; // cap, never jank
      for (var i = 0; i < n; i++) {
        var d = document.createElement("i");
        var size = 3 + Math.random() * 4;
        d.style.cssText = "position:absolute;left:0;top:0;width:" + size + "px;height:" + size +
          "px;background:" + DUST_INKS[(Math.random() * DUST_INKS.length) | 0] +
          ";border-radius:1px;will-change:transform,opacity";
        dustLayer.appendChild(d);
        var ang = Math.random() * 6.283, sp = spread * (0.3 + Math.random());
        var dx = -dvx * 0.06 + Math.cos(ang) * sp;
        var dy = -dvy * 0.06 + Math.sin(ang) * sp - 24 * Math.random();
        d.animate([
          { transform: "translate3d(" + cx + "px," + cy + "px,0) rotate(0deg) scale(1)", opacity: 0.95 },
          { transform: "translate3d(" + (cx + dx) + "px," + (cy + dy) + "px,0) rotate(" + ((Math.random() - 0.5) * 200) + "deg) scale(.35)", opacity: 0 }
        ], { duration: 380 + Math.random() * 260, easing: "cubic-bezier(.2,.7,.3,1)" })
          .onfinish = (function (el) { return function () { el.remove(); }; })(d);
      }
    }

    function startThrow(vx, vy) {
      if (panel.classList.contains("open")) {
        panel.classList.remove("open");
        fab.classList.remove("active");
      }
      fab.classList.add("flying");
      say("throw_", true);
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

        if (px < minX) { px = minX; vx = -vx * BOUNCE; impact(); dust(px + w / 2, py + h / 2, vx, vy, 9, 80); }
        if (px > maxX) { px = maxX; vx = -vx * BOUNCE; impact(); dust(px + w / 2, py + h / 2, vx, vy, 9, 80); }
        if (py < minY) { py = minY; vy = -vy * BOUNCE; impact(); dust(px + w / 2, py + h / 2, vx, vy, 9, 80); }
        var onFloor = false;
        if (py >= floorY) {
          py = floorY;
          onFloor = true;
          if (vy > 180) { vy = -vy * BOUNCE; vx *= 0.85; impact(); dust(px + w / 2, py + h, vx, vy, 10, 90); }
          else { vy = 0; }
          vx *= Math.max(0, 1 - 5 * dt);
        }

        rot += vx * dt * 0.3;
        flight.px = px; flight.py = py;
        fab.style.transform = "translate3d(" + (px - ox) + "px," + (py - oy) + "px,0)";

        // squash-and-stretch ALONG the motion vector — rotate into the
        // velocity frame, stretch, rotate back out into his tumble
        var speed = Math.hypot(vx, vy);
        var st = Math.min(0.2, (speed / 3200) * 0.22);
        if (onFloor && vy === 0) st *= 0.3; // sliding, not flying
        var th = Math.atan2(vy, vx) * 57.2958;
        wrap.style.transform = "rotate(" + th.toFixed(1) + "deg) scale(" + (1 + st).toFixed(3) + "," + (1 - st).toFixed(3) + ") rotate(" + (rot - th).toFixed(1) + "deg)";

        // trail: emit by distance travelled, so it's continuous at any speed
        flight.trailAcc = (flight.trailAcc || 0) + speed * dt;
        while (flight.trailAcc > 13) {
          flight.trailAcc -= 13;
          dust(px + w / 2, py + h / 2, vx, vy, 1, 15);
        }

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
      if (Math.abs(nx - fab.offsetLeft) > 2 || Math.abs(ny - fab.offsetTop) > 2) {
        if (!drag.moved) say("pickup");
        drag.moved = true;
      }
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

    /* idle quirks: every so often, when nobody's bothering him, he waves,
       hops, has a look around, or mutters a beep. Never while flying,
       being dragged, mid-chat, or in a hidden tab. */
    LINES.idle = ["beep.", "need anything?", "still here!", "all quiet. nice."];
    function quirk() {
      setTimeout(function () {
        if (!flight && !drag && !panel.classList.contains("open") && !document.hidden && !calmMotion) {
          var r = Math.random();
          var cls = r < 0.45 ? "idle-wave" : r < 0.75 ? "idle-hop" : r < 0.9 ? "idle-look" : null;
          if (cls) {
            fab.classList.add(cls);
            setTimeout(function () { fab.classList.remove(cls); }, 1000);
          } else {
            say("idle", true);
          }
        }
        quirk();
      }, 20000 + Math.random() * 18000);
    }
    quirk();

    // tab hidden mid-flight: rAF pauses, so land him now rather than resume
    // a stale trajectory whenever the tab comes back
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && flight) settleFlight();
    });
    window.addEventListener("resize", function () { if (!flight) place(fab.offsetLeft, fab.offsetTop); });

    /* ================= the working buddy =================
       Everything below is driven by REAL events. He only walks because a
       tool genuinely started; he only downs tools because the server said
       the step finished. There is no timer anywhere in here pretending to
       be work — if he's moving, something is actually happening. */

    // Which part of the app each tool belongs to. When a tool starts, he
    // walks to that part of the screen, so you can see where the work is
    // landing before the page even changes.
    var TOOL_HOME = {
      create_post: "social", schedule_post: "social", list_scheduled_posts: "social",
      update_post: "social", generate_image: "social", generate_video: "social",
      get_insights: "analytics", research_competitor: "analytics",
      create_lead: "crm",
      book_appointment: "appointments",
      get_website: "website", build_website: "website", edit_website: "website",
      publish_website: "website", get_website_html: "website",
      ingest_website: "settings", get_knowledge: "settings",
      remember: "settings", recall: "settings", forget: "settings",
      add_task: "overview", list_tasks: "overview", complete_task: "overview",
      manage_employee: "employees", get_usage: "settings",
      list_automations: "automations", create_automation: "automations",
      test_automation: "automations", list_automation_options: "automations",
    };

    // Where on screen that part of the app lives right now. The sidebar link
    // is the honest answer — it's the thing you'd click to go there.
    function homeTarget(page) {
      var link = document.querySelector('.side-link[data-page="' + page + '"]');
      if (!link) return null;
      var r = link.getBoundingClientRect();
      if (!r.width) return null;
      return { x: r.right + 14, y: r.top + r.height / 2 - fab.offsetHeight / 2 };
    }

    var walk = null;      // the in-progress walk, if any
    var restPos = null;   // where he was before he went to work

    function stopWalk() {
      if (!walk) return;
      cancelAnimationFrame(walk.raf);
      walk = null;
      fab.classList.remove("walking", "face-left");
    }

    /**
     * Walk him there. Not a teleport and not a CSS transition — a per-frame
     * step with a little bob, so it reads as "he went over to do the job".
     * A drag or a throw cancels it; the human always wins.
     */
    function walkTo(target, done) {
      if (!target || calmMotion) { if (done) done(); return; }
      stopWalk();
      stopFlight();
      var from = clamp(fab.offsetLeft, fab.offsetTop);
      var to = clamp(target.x, target.y);
      var dx = to.x - from.x, dy = to.y - from.y;
      var dist = Math.hypot(dx, dy);
      if (dist < 24) { if (done) done(); return; }
      var dur = Math.min(900, Math.max(260, dist * 1.15));
      var t0 = performance.now();
      fab.classList.add("walking");
      fab.classList.toggle("face-left", dx < 0);

      function frame(now) {
        if (drag || flight) { stopWalk(); return; }   // he's been grabbed
        var p = Math.min(1, (now - t0) / dur);
        var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
        var x = from.x + dx * e;
        var y = from.y + dy * e - Math.sin(p * Math.PI) * 18; // a little arc
        fab.style.left = x + "px";
        fab.style.top = y + "px";
        if (p < 1) { walk.raf = requestAnimationFrame(frame); return; }
        stopWalk();
        if (done) done();
      }
      walk = { raf: requestAnimationFrame(frame) };
    }

    // A small word balloon that says what he's actually doing right now.
    var statusBubble = null, statusHide = null;
    function status(text) {
      if (!text) {
        if (statusBubble) { statusBubble.classList.remove("on"); }
        return;
      }
      if (!statusBubble) {
        statusBubble = HL.el("div", "px-status");
        document.body.appendChild(statusBubble);
      }
      statusBubble.textContent = text;
      var r = fab.getBoundingClientRect();
      // flip to whichever side has room, so it never runs off screen
      var left = r.left + r.width / 2;
      statusBubble.classList.toggle("flip", left > window.innerWidth - 190);
      statusBubble.style.left = left + "px";
      statusBubble.style.top = (r.top - 10) + "px";
      statusBubble.classList.add("on");
      clearTimeout(statusHide);
      statusHide = setTimeout(function () { statusBubble.classList.remove("on"); }, 4200);
    }
    // keep the balloon stuck to him while he walks
    function followStatus() {
      if (!statusBubble || !statusBubble.classList.contains("on")) return;
      var r = fab.getBoundingClientRect();
      statusBubble.style.left = (r.left + r.width / 2) + "px";
      statusBubble.style.top = (r.top - 10) + "px";
      statusBubble.classList.toggle("flip", r.left + r.width / 2 > window.innerWidth - 190);
    }
    setInterval(followStatus, 120);

    /* ---- the public control surface ----
       social.js (every chat panel) and this file both drive him through
       this, so wherever the work is started from, he reacts the same. */
    var busyDepth = 0;
    var navPending = false;   // a page-open is mid-walk; don't interrupt it
    HL.buddy = {
      // "He's thinking" — the gap before a tool call, which is most of the wait.
      think: function (label) {
        busyDepth++;
        fab.classList.remove("idle-wave", "idle-hop", "idle-look");
        fab.classList.add("busy", "thinking");
        status(label || "Thinking…");
      },
      // A real tool started. Walk to where that work lives and roll sleeves up.
      tool: function (toolName, label) {
        fab.classList.remove("thinking");
        fab.classList.add("busy", "working");
        status(label || "Working…");
        var page = TOOL_HOME[toolName];
        if (!page) return;
        var t = homeTarget(page);
        if (!t) return;
        if (!restPos) restPos = clamp(fab.offsetLeft, fab.offsetTop);
        walkTo(t);
      },
      // A step finished — a quick nod, nothing more.
      step: function (ok) {
        fab.classList.remove("nod", "oops");
        void fab.offsetWidth;
        fab.classList.add(ok ? "nod" : "oops");
        setTimeout(function () { fab.classList.remove("nod", "oops"); }, 520);
      },
      // The turn is over. Down tools, walk home, and stay out of the way.
      done: function (msg) {
        busyDepth = Math.max(0, busyDepth - 1);
        if (busyDepth) return;                       // another job still running
        fab.classList.remove("thinking", "working");
        // If he's on his way to open a page, leave him to it. This used to
        // cut the walk short, which killed the callback that did the actual
        // navigating — the AI said it opened a page and nothing happened.
        if (navPending) return;
        status(msg || null);
        var home = restPos;
        restPos = null;
        if (home) {
          walkTo(home, function () { fab.classList.remove("busy"); savePos(); });
        } else {
          fab.classList.remove("busy");
        }
      },
      // Open a page — this is how the AI genuinely drives the app.
      goToPage: function (page, why) {
        var t = homeTarget(page);
        var home = restPos || clamp(fab.offsetLeft, fab.offsetTop);
        restPos = null;
        status(why || "Opening " + page + "…");

        navPending = true;
        function go() {
          if (!navPending) return;        // already handled
          navPending = false;
          location.hash = "#/" + page;
          walkTo(home, function () { fab.classList.remove("busy"); savePos(); });
        }
        if (t) walkTo(t, go); else go();
        // The walk can be cancelled — a drag, a resize, another turn starting.
        // The page still has to open, because the owner asked for it.
        setTimeout(go, 1400);
      },
      say: function (text) { status(text); },
    };

    /* ---------- open / close ---------- */
    var greeted = false;
    function toggle() {
      var opening = !panel.classList.contains("open");
      if (opening) {
        place(fab.offsetLeft, fab.offsetTop);
        placePanel(clamp(fab.offsetLeft, fab.offsetTop));
        panel.classList.add("open");
        fab.classList.add("active");
        if (!greeted) {
          greeted = true;
          // Pick the thread back up where it was left — this little panel is
          // the one the owner uses most, so losing its thread on a page
          // change was the most annoying version of the forgetting problem.
          HL.api("/api/chat/history?thread=assistant")
            .then(function (out) {
              var t = (out && out.transcript) || [];
              if (!t.length) {
                add("bot", "I'm right here. Ask me anything, or tell me to do something — write posts, build an automation, change your website.");
                return;
              }
              t.slice(-8).forEach(function (m) { if (m.text) add(m.role === "user" ? "user" : "bot", m.text); });
            })
            .catch(function () {
              add("bot", "I'm right here. Ask me anything, or tell me to do something — write posts, build an automation, change your website.");
            });
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
      var el;
      if (kind.indexOf("bot") === 0) {
        var row = HL.el("div", "ap-row");
        row.innerHTML = miniBot(20);
        el = HL.el("div", "ap-m " + kind);
        el.textContent = text;
        row.appendChild(el);
        msgs.appendChild(row);
      } else {
        el = HL.el("div", "ap-m " + kind);
        el.textContent = text;
        msgs.appendChild(el);
      }
      if (msgs.children.length > 1) chips.classList.add("off");
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
      var payload = { thread: "assistant", message: text };
      var startPage = (location.hash || "#/overview").replace(/^#\//, "").split("?")[0] || "overview";
      var job = HL.jobStart ? HL.jobStart(startPage, text.slice(0, 42)) : null;

      function land(out) {
        settled = true;
        think.done();
        if (out.reply) add("bot", out.reply);
        busy = false;
        input.focus();
        HL.buddy.done();
        if (job) HL.jobDone(job, (out.steps || []).length
          ? "Done — " + text.slice(0, 40) : "Answered", true);

        // The AI asked to open a page. He walks there and the page changes —
        // this is the one place the assistant genuinely drives the app.
        var nav = (out.actions || []).filter(function (a) { return a.type === "navigate"; })[0];
        if (nav) { HL.buddy.goToPage(nav.page, nav.why); return; }

        // otherwise refresh only if the user is still where the work landed —
        // never yank them off a different page
        var nowPage = (location.hash || "#/overview").replace(/^#\//, "").split("?")[0];
        if ((out.actions || []).length && nowPage === startPage) HL.navigate();
      }
      function fail(msg) {
        settled = true;
        think.drop();
        add("bot", "Sorry — " + msg);
        busy = false;
        input.focus();
        HL.buddy.done();
        if (job) HL.jobDone(job, "Couldn't finish: " + text.slice(0, 36), false);
      }

      HL.buddy.think();
      HL.stream("/api/chat/stream", payload, function (ev) {
        if (ev.phase === "model") { think.say("Thinking…"); if (job) HL.jobStep(job, "Thinking…"); HL.buddy.think(); }
        else if (ev.phase === "tool-start") {
          think.say("Working…"); think.start(ev.tool);
          if (job) HL.jobStep(job, ((HL.STEP_LABELS && HL.STEP_LABELS[ev.tool]) || ev.tool.replace(/_/g, " ")) + "…");
          HL.buddy.tool(ev.tool, HL.STEP_LABELS && HL.STEP_LABELS[ev.tool]);
        }
        else if (ev.phase === "step") { think.finish(ev.tool, ev.ok); HL.buddy.step(ev.ok); }
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
