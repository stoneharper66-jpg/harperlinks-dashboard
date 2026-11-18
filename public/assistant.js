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
    fab.innerHTML =
      '<span class="fab-ring"></span>' +
      '<svg class="fab-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true">' +
      '<path d="M15 21l6-6" stroke="url(#gradStroke)" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M13 23l-2.5 2.5a5 5 0 01-7-7L8 14a5 5 0 017 0" stroke="#4DA3FF" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M23 13l2.5-2.5a5 5 0 017 7L28 22a5 5 0 01-7 0" stroke="#FF5CA8" stroke-width="2.8" stroke-linecap="round"/>' +
      "</svg>" +
      '<span class="fab-tip">Ask HarperLinks</span>';
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

    var drag = null;
    fab.addEventListener("pointerdown", function (ev) {
      drag = {
        dx: ev.clientX - fab.offsetLeft,
        dy: ev.clientY - fab.offsetTop,
        moved: false,
      };
      fab.setPointerCapture(ev.pointerId);
      fab.classList.add("dragging");
    });
    fab.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var nx = ev.clientX - drag.dx, ny = ev.clientY - drag.dy;
      if (Math.abs(nx - fab.offsetLeft) > 2 || Math.abs(ny - fab.offsetTop) > 2) drag.moved = true;
      place(nx, ny);
    });
    function endDrag(ev) {
      if (!drag) return;
      fab.classList.remove("dragging");
      try { fab.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      var p = clamp(fab.offsetLeft, fab.offsetTop);
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
      var wasDrag = drag.moved;
      drag = null;
      if (!wasDrag) toggle(); // a click, not a drag
    }
    fab.addEventListener("pointerup", endDrag);
    fab.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", function () { place(fab.offsetLeft, fab.offsetTop); });

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
