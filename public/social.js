/* Shared AI chat builder (with visible thinking steps) + the Social Media page. */
(function () {
  "use strict";
  var HL = window.HL;

  /* friendly labels for the bot's tool steps */
  HL.STEP_LABELS = {
    ingest_website: "Reading the website",
    get_business_profile: "Checking what I know about the business",
    get_knowledge: "Checking the knowledge base",
    create_post: "Writing content",
    schedule_post: "Scheduling it",
    list_scheduled_posts: "Checking the calendar",
    update_post: "Updating a post",
    create_lead: "Saving the lead to the CRM",
    book_appointment: "Checking the calendar & booking",
    add_task: "Adding the task",
  };

  /* ---------- the shared chat panel ---------- */
  HL.buildChat = function (opts) {
    opts = opts || {};
    var panel, scroll;
    if (opts.bare) {
      panel = HL.el("div", "cc-chat");
      scroll = HL.el("div", "cc-scroll");
      panel.appendChild(scroll);
    } else {
      panel = HL.el("section", "panel chat-panel");
      if (opts.tall) panel.classList.add("chat-tall");
      var head = HL.el("div", "panel-head");
      head.appendChild(HL.el("h2", null, opts.title || "Your AI team"));
      head.appendChild(HL.el("span", "hint", opts.hint || "Tell it what you need — it does the work"));
      panel.appendChild(head);
      scroll = HL.el("div", "chat-scroll");
      panel.appendChild(scroll);
    }

    function addMsg(kind, text) {
      var el = HL.el("div", "msg " + kind, text);
      scroll.appendChild(el);
      scroll.scrollTop = scroll.scrollHeight;
      return el;
    }

    if (opts.greet) {
      var greet = HL.el("div", "msg bot", opts.greet);
      if (opts.greetSmall) {
        var sm = HL.el("span", "small", opts.greetSmall);
        greet.appendChild(sm);
      }
      scroll.appendChild(greet);
    }

    function addThinking(steps) {
      if (!steps || !steps.length) return;
      var block = HL.el("div", "think");
      var headEl = HL.el("button", "think-head");
      headEl.type = "button";
      headEl.innerHTML = '<span class="tspark">✦</span> Did ' + steps.length + " step" + (steps.length > 1 ? "s" : "") +
        ' <span class="tchev">▾</span>';
      var list = HL.el("div", "think-list");
      steps.forEach(function (s) {
        var r = HL.el("div", "think-row");
        r.innerHTML = (s.ok ? '<span class="tok">✓</span>' : '<span class="tbad">!</span>') +
          "<span>" + HL.esc(HL.STEP_LABELS[s.tool] || s.tool) + "</span>";
        list.appendChild(r);
      });
      block.appendChild(headEl);
      block.appendChild(list);
      headEl.addEventListener("click", function () { block.classList.toggle("open"); });
      scroll.appendChild(block);
      scroll.scrollTop = scroll.scrollHeight;
    }

    /* A thinking block that fills in while the work is happening.
       Every row is driven by a real server event — a row only appears because
       the bot actually started that tool, and only ticks when it really
       finished. Nothing here is on a timer. */
    function startLiveThinking() {
      var block = HL.el("div", "think open");
      var headEl = HL.el("button", "think-head");
      headEl.type = "button";
      headEl.innerHTML = '<span class="tspark">✦</span><span class="thead-text">Thinking…</span><span class="tchev">▾</span>';
      var list = HL.el("div", "think-list");
      block.appendChild(headEl);
      block.appendChild(list);
      headEl.addEventListener("click", function () { block.classList.toggle("open"); });
      scroll.appendChild(block);
      scroll.scrollTop = scroll.scrollHeight;

      var waiting = {}; // tool name → rows started but not yet finished
      var done = 0;
      function label(tool) { return HL.esc(HL.STEP_LABELS[tool] || tool); }

      return {
        head: function (t) { headEl.querySelector(".thead-text").textContent = t; },
        toolStart: function (tool) {
          var r = HL.el("div", "think-row pending");
          r.innerHTML = '<span class="tspin"></span><span>' + label(tool) + "</span>";
          list.appendChild(r);
          (waiting[tool] = waiting[tool] || []).push(r);
          scroll.scrollTop = scroll.scrollHeight;
        },
        stepDone: function (tool, ok) {
          var r = (waiting[tool] || []).shift();
          if (!r) { r = HL.el("div", "think-row"); list.appendChild(r); }
          r.className = "think-row";
          r.innerHTML = (ok ? '<span class="tok">✓</span>' : '<span class="tbad">!</span>') +
            "<span>" + label(tool) + "</span>";
          done++;
          scroll.scrollTop = scroll.scrollHeight;
        },
        finish: function () {
          headEl.querySelector(".thead-text").textContent =
            done ? "Did " + done + " step" + (done > 1 ? "s" : "") : "Thought it through";
          block.classList.remove("open");
        },
        remove: function () { block.remove(); },
      };
    }

    /* ---- live-build bench (engaged command centre) ---- */
    var benchLabel = null, benchBody = null;
    if (opts.bench) {
      benchLabel = HL.el("div", "bench-label");
      benchLabel.innerHTML = '<span class="bdot"></span><span class="btext">Live build</span>';
      opts.bench.appendChild(benchLabel);
      benchBody = HL.el("div");
      benchBody.style.cssText = "display:flex;flex-direction:column;gap:10px";
      opts.bench.appendChild(benchBody);
      benchBody.appendChild(HL.el("div", "bench-empty", "Whatever I build lands here as I make it — posts, videos, bookings, tasks."));
    }
    function benchStatus(working, text) {
      if (!benchLabel) return;
      benchLabel.classList.toggle("working", !!working);
      benchLabel.querySelector(".btext").textContent = text || (working ? "Building…" : "Live build");
      // while it's working and nothing has landed yet, show a shimmering
      // placeholder so the build area visibly "warms up" instead of sitting dead
      if (benchBody) {
        var hasItems = !!benchBody.querySelector(".bench-item");
        var skel = benchBody.querySelector(".bench-skel");
        if (working && !hasItems && !skel) {
          var emptyMsg = benchBody.querySelector(".bench-empty");
          if (emptyMsg) emptyMsg.remove();
          skel = HL.el("div", "bench-skel");
          skel.innerHTML = "<i></i><i></i><i></i>";
          benchBody.appendChild(skel);
        } else if ((!working || hasItems) && skel) {
          skel.remove();
        }
      }
    }
    function benchItem(action) {
      if (!benchBody) return;
      var empty = benchBody.querySelector(".bench-empty");
      if (empty) empty.remove();
      var skel = benchBody.querySelector(".bench-skel");
      if (skel) skel.remove();
      var rec = action.record;
      var kind = "", body = "", meta = [];
      if (action.type === "post" && rec) {
        kind = rec.isVideo ? "Video script · " + rec.platform : "Post · " + rec.platform;
        body = rec.content;
        meta.push('<span class="pill-st ' + rec.status + '">' + rec.status + "</span>");
        if (action.heldForApproval) meta.push('<span class="pill-st amber">awaiting approval</span>');
        if (rec.scheduledAt) meta.push('<span class="q-when">' + HL.esc(HL.fmtWhen(rec.scheduledAt)) + "</span>");
      } else if (action.type === "appointment" && rec) {
        kind = "Appointment";
        body = rec.customer_name + " — " + rec.service;
        meta.push('<span class="q-when">' + HL.esc(HL.fmtWhen(rec.startsAt)) + "</span>");
      } else if (action.type === "lead" && rec) {
        kind = "Lead";
        body = rec.name + (rec.interest ? " — " + rec.interest : "");
        meta.push('<span class="pill-st new">new</span>');
      } else if (action.type === "task" && rec) {
        kind = "Task";
        body = rec.what;
        if (rec.dueAt) meta.push('<span class="q-when">due ' + HL.esc(HL.fmtWhen(rec.dueAt)) + "</span>");
      } else if (action.type === "profile" && action.profile) {
        kind = "Business learned";
        body = action.profile.name + " — " + (action.profile.tagline || action.profile.businessType);
      } else {
        return;
      }
      var el = HL.el("div", "bench-item");
      el.innerHTML = '<div class="bi-kind"></div><div class="bi-body"></div>' + (meta.length ? '<div class="bi-meta">' + meta.join("") + "</div>" : "");
      el.querySelector(".bi-kind").textContent = kind;
      el.querySelector(".bi-body").textContent = body;
      benchBody.prepend(el);
      opts.bench.scrollTop = 0;
    }

    function addActionCard(action) {
      var rec = action.record;
      var el;
      if (action.type === "post" && rec) {
        el = HL.el("div", "action-card");
        var kind = rec.isVideo ? "Video script" : rec.platform.charAt(0).toUpperCase() + rec.platform.slice(1) + " post";
        el.innerHTML = '<div class="ac-top">' + (HL.PLAT_ICONS[rec.platform] || "") +
          '<span class="ac-title">' + HL.esc(kind) + "</span></div>" +
          '<div class="ac-body"></div><div class="ac-meta"></div>';
        el.querySelector(".ac-body").textContent = rec.content + (rec.hashtags && rec.hashtags.length ? "\n" + rec.hashtags.map(function (h) { return "#" + h; }).join(" ") : "");
        var meta = el.querySelector(".ac-meta");
        meta.appendChild(HL.el("span", "pill-st " + rec.status, rec.status));
        if (action.heldForApproval) meta.appendChild(HL.el("span", "pill-st amber", "awaiting your approval"));
        if (rec.scheduledAt) meta.appendChild(HL.el("span", "q-when", HL.fmtWhen(rec.scheduledAt)));
        if (rec.isVideo) meta.appendChild(HL.el("span", "q-when", "script ready · footage needs Video AI"));
      }
      if (action.type === "lead" && rec) {
        el = HL.el("div", "action-card");
        el.innerHTML = '<div class="ac-top"><span class="ac-title">Lead captured</span></div><div class="ac-body"></div>';
        el.querySelector(".ac-body").textContent = rec.name + (rec.interest ? " — " + rec.interest : "");
      }
      if (action.type === "appointment" && rec) {
        el = HL.el("div", "action-card");
        el.innerHTML = '<div class="ac-top"><span class="ac-title">Appointment booked</span></div><div class="ac-body"></div>';
        el.querySelector(".ac-body").textContent = rec.customer_name + " — " + rec.service + ", " + HL.fmtWhen(rec.startsAt);
      }
      if (action.type === "task" && rec) {
        el = HL.el("div", "action-card");
        el.innerHTML = '<div class="ac-top"><span class="ac-title">Task added</span></div><div class="ac-body"></div>';
        el.querySelector(".ac-body").textContent = rec.what + (rec.dueAt ? " — due " + HL.fmtWhen(rec.dueAt) : "");
      }
      if (action.type === "profile" && action.profile) {
        el = HL.el("div", "action-card");
        el.innerHTML = '<div class="ac-top"><span class="ac-title">Business learned</span></div><div class="ac-body"></div>';
        el.querySelector(".ac-body").textContent = action.profile.name + " — " + (action.profile.tagline || action.profile.businessType);
      }
      if (el) {
        scroll.appendChild(el);
        scroll.scrollTop = scroll.scrollHeight;
      }
    }

    var sending = false;
    var firstSent = false;
    function send(text) {
      if (sending || !text.trim()) return;
      sending = true;
      if (!firstSent) {
        firstSent = true;
        if (opts.onFirstSend) opts.onFirstSend();
      }
      addMsg("user", text.trim());
      input.value = "";
      benchStatus(true);

      var payload = { sessionId: HL.sessionId, message: text.trim(), employee: opts.employee || undefined };
      var live = startLiveThinking();
      var settled = false;

      function release() { sending = false; input.focus(); }
      function land(out) {
        settled = true;
        live.finish();
        (out.actions || []).forEach(function (a) { opts.bench ? benchItem(a) : addActionCard(a); });
        if (out.reply) addMsg("bot", out.reply);
        benchStatus(false);
        release();
        if (opts.onWorkDone) opts.onWorkDone(out);
      }
      function fail(msg) {
        settled = true;
        live.remove();
        benchStatus(false);
        addMsg("bot", "Sorry — " + msg);
        release();
      }

      HL.stream("/api/chat/stream", payload, function (ev) {
        if (ev.phase === "model") live.head("Thinking…");
        else if (ev.phase === "tool-start") { live.head("Working…"); live.toolStart(ev.tool); }
        else if (ev.phase === "step") live.stepDone(ev.tool, ev.ok);
        else if (ev.phase === "done") land(ev);
        else if (ev.phase === "error") fail(ev.error);
      })
        .then(function () {
          // stream closed without a final event — say so rather than hang
          if (!settled) fail("the connection dropped mid-answer.");
        })
        .catch(function () {
          // older browser, or the stream never opened: fall back to the plain
          // endpoint, which still works — just without live progress
          if (settled) return;
          live.remove();
          HL.post("/api/chat", payload)
            .then(function (out) { addThinking(out.steps); land(out); })
            .catch(function (e) { fail(e.message); });
        });
    }

    if (opts.chips && opts.chips.length) {
      var chips = HL.el("div", "chips");
      opts.chips.forEach(function (c) {
        var b = HL.el("button", "chip", c);
        b.addEventListener("click", function () { send(c); });
        chips.appendChild(b);
      });
      panel.appendChild(chips);
    }

    var form = HL.el("form", opts.bare ? "cc-compose" : "composer");
    var input = document.createElement("input");
    input.setAttribute("aria-label", opts.placeholder || "Tell your AI team what to do…");
    // bare mode: suggestions live on their own hint layer and crossfade
    // cleanly. The old approach dimmed the INPUT itself to swap the
    // placeholder attribute — caret and all — which looked broken mid-fade.
    if (opts.bare && Array.isArray(opts.placeholders) && opts.placeholders.length) {
      var hint = HL.el("span", "ph-hint", opts.placeholders[0]);
      form.appendChild(hint);
      var phI = 0;
      function syncHint() { hint.classList.toggle("hidden", !!input.value); }
      input.addEventListener("input", syncHint);
      setInterval(function () {
        if (document.activeElement === input || input.value) return;
        hint.classList.add("out");
        setTimeout(function () {
          phI = (phI + 1) % opts.placeholders.length;
          hint.textContent = opts.placeholders[phI];
          hint.classList.remove("out");
          hint.classList.add("in");
          setTimeout(function () { hint.classList.remove("in"); }, 420);
        }, 380);
      }, 3800);
    } else {
      input.placeholder = opts.placeholder || "Tell your AI team what to do…";
    }
    var btn = HL.el("button", "send-btn");
    btn.type = "submit";
    btn.setAttribute("aria-label", "Send");
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
    form.appendChild(input);
    form.appendChild(btn);
    form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value); });
    panel.appendChild(form);
    panel._send = send;
    return panel;
  };

  /* ================= SOCIAL MEDIA PAGE ================= */
  var postsCache = [];
  var calCursor = null;

  function platIcon(p) {
    return '<div class="q-plat">' + (HL.PLAT_ICONS[p] || "") + "</div>";
  }

  function buildCalendar() {
    var panel = HL.panel("Content calendar", "Dots = scheduled & published posts");
    var body = HL.el("div", "panel-body");
    panel.appendChild(body);
    if (!calCursor) { calCursor = new Date(); calCursor.setDate(1); }
    var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    function render() {
      body.innerHTML = "";
      var head = HL.el("div");
      head.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px";
      head.appendChild(HL.el("strong", null, MONTHS[calCursor.getMonth()] + " " + calCursor.getFullYear()));
      var navB = HL.el("div");
      ["‹", "›"].forEach(function (s, i) {
        var b = HL.el("button", "btn ghost sm", s);
        b.style.marginLeft = "6px";
        b.addEventListener("click", function () { calCursor.setMonth(calCursor.getMonth() + (i ? 1 : -1)); render(); });
        navB.appendChild(b);
      });
      head.appendChild(navB);
      body.appendChild(head);
      var grid = HL.el("div", "bigcal-grid");
      ["Mo","Tu","We","Th","Fr","Sa","Su"].forEach(function (d) { grid.appendChild(HL.el("div", "bigcal-dow", d)); });
      var y = calCursor.getFullYear(), m = calCursor.getMonth();
      var startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
      var days = new Date(y, m + 1, 0).getDate();
      var today = new Date();
      for (var i = 0; i < startOffset; i++) grid.appendChild(HL.el("div", "bigcal-day dim"));
      for (var d = 1; d <= days; d++) {
        var cell = HL.el("div", "bigcal-day");
        if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) cell.classList.add("today");
        cell.appendChild(HL.el("div", "dnum", String(d)));
        var dayPosts = postsCache.filter(function (p) {
          var t = p.scheduledAt || p.publishedAt;
          if (!t || p.status === "cancelled") return false;
          var pd = new Date(t);
          return pd.getFullYear() === y && pd.getMonth() === m && pd.getDate() === d;
        });
        dayPosts.slice(0, 3).forEach(function (p) {
          var ev = HL.el("div", "bigcal-ev" + (p.status === "published" ? " grey" : p.platform === "tiktok" ? " pink" : ""));
          ev.textContent = (p.isVideo ? "video · " : "") + p.platform + ": " + p.content.slice(0, 24);
          ev.title = p.content;
          cell.appendChild(ev);
        });
        if (dayPosts.length > 3) cell.appendChild(HL.el("div", "bigcal-ev grey", "+" + (dayPosts.length - 3) + " more"));
        grid.appendChild(cell);
      }
      body.appendChild(grid);
    }
    render();
    panel._rerender = render;
    return panel;
  }

  function postEditor(post, refresh) {
    var body = HL.el("div");
    var platform = HL.select(["instagram", "facebook", "tiktok", "linkedin"], post ? post.platform : "instagram");
    var content = document.createElement("textarea");
    content.className = "textarea";
    content.value = post ? post.content : "";
    content.placeholder = "Write the caption…";
    var tags = HL.input("hashtags, comma separated", post ? (post.hashtags || []).join(", ") : "");
    var when = HL.input("e.g. tomorrow 10am, next week (blank = draft)", "");
    body.appendChild(HL.field("Platform", platform));
    body.appendChild(HL.field("Caption", content));
    body.appendChild(HL.field("Hashtags", tags));
    body.appendChild(HL.field(post ? "Reschedule (optional)" : "Schedule (optional)", when));
    HL.modal(post ? "Edit post" : "New post", body, function () {
      var payload = {
        platform: platform.value,
        content: content.value,
        hashtags: tags.value.split(",").map(function (t) { return t.trim().replace(/^#/, ""); }).filter(Boolean),
      };
      if (when.value.trim()) payload.scheduledFor = when.value.trim();
      var req = post ? HL.post("/api/posts/" + post.id, payload, "PATCH") : HL.post("/api/posts", payload);
      return req.then(function () { HL.toast(post ? "Post updated" : "Post saved"); refresh(); });
    }, post ? "Save changes" : "Save post");
  }

  function buildQueue(refresh) {
    var panel = HL.panel("Publishing queue", "");
    var headBtn = HL.el("button", "btn sm", "+ New post");
    headBtn.addEventListener("click", function () { postEditor(null, refresh); });
    panel.querySelector(".panel-head").appendChild(headBtn);
    var body = HL.el("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:10px;padding:14px 16px;max-height:430px;overflow-y:auto";
    panel.appendChild(body);
    var visible = postsCache.filter(function (p) { return p.status !== "cancelled"; });
    visible.sort(function (a, b) { return new Date(a.scheduledAt || a.createdAt) - new Date(b.scheduledAt || b.createdAt); });
    panel.querySelector(".hint").textContent = visible.filter(function (p) { return p.status === "scheduled"; }).length + " scheduled · " +
      visible.filter(function (p) { return p.status === "draft"; }).length + " drafts";
    if (!visible.length) {
      body.appendChild(HL.emptyState("", "No posts yet. Ask Sage to write some, or create one yourself.", "+ New post", function () { postEditor(null, refresh); }));
      return panel;
    }
    visible.forEach(function (p) {
      var item = HL.el("div", "q-item");
      item.innerHTML = platIcon(p.platform) + '<div class="q-main"><div class="q-text"></div><div class="q-when"></div><div class="q-actions"></div></div>';
      item.querySelector(".q-text").textContent = (p.isVideo ? "VIDEO · " : "") + p.content;
      item.querySelector(".q-when").textContent = p.status === "published"
        ? "Went out " + HL.fmtWhen(p.publishedAt) + " (simulated — platform not connected)"
        : p.scheduledAt ? HL.fmtWhen(p.scheduledAt) : "Draft — not scheduled";
      var st = HL.el("span", "pill-st " + p.status, p.status);
      item.appendChild(st);
      var acts = item.querySelector(".q-actions");
      if (p.status !== "published") {
        var edit = HL.el("button", null, "Edit");
        edit.addEventListener("click", function () { postEditor(p, refresh); });
        acts.appendChild(edit);
        var cancel = HL.el("button", null, p.status === "scheduled" ? "Unschedule" : "Delete");
        cancel.addEventListener("click", function () {
          var req = p.status === "scheduled"
            ? HL.post("/api/posts/" + p.id, { status: "draft" }, "PATCH")
            : HL.api("/api/posts/" + p.id, { method: "DELETE" });
          req.then(refresh).catch(function (e) { HL.toast(e.message, true); });
        });
        acts.appendChild(cancel);
      }
      body.appendChild(item);
    });
    return panel;
  }

  HL.pages.social = {
    title: "Social Media",
    render: function () {
      return Promise.all([HL.api("/api/posts"), HL.api("/api/profile")]).then(function (res) {
        postsCache = res[0];
        var profile = res[1];
        var root = HL.el("div");

        if (!profile.configured) {
          root.appendChild(HL.setupNote("<b>Tip:</b> tell the chat your website URL first — content comes out in your voice."));
        }

        var stats = HL.el("div", "grid cols-4");
        stats.appendChild(HL.stat("Published", postsCache.filter(function (p) { return p.status === "published"; }).length, "via pipeline (preview mode)"));
        stats.appendChild(HL.stat("Scheduled", postsCache.filter(function (p) { return p.status === "scheduled"; }).length, "waiting in the queue"));
        stats.appendChild(HL.stat("Drafts", postsCache.filter(function (p) { return p.status === "draft"; }).length, "awaiting review"));
        stats.appendChild(HL.stat("Engagement", null, "connect Instagram/Facebook to track"));
        root.appendChild(stats);
        stats.style.marginBottom = "16px";

        var cols = HL.el("div", "grid");
        cols.style.gridTemplateColumns = window.innerWidth < 980 ? "1fr" : "minmax(0,1.2fr) minmax(0,1fr)";

        function refresh() {
          HL.api("/api/posts").then(function (posts) {
            postsCache = posts;
            var newQ = buildQueue(refresh);
            right.replaceChild(newQ, right.firstChild);
            cal._rerender && cal._rerender();
          });
        }

        cols.appendChild(HL.buildChat({
          title: "Sage — Social Media Manager",
          hint: "Writes & schedules your content",
          greet: "G'day! I write posts and video scripts in your brand voice, plan the week and run the calendar.",
          chips: ["Write me 5 posts for next week", "Make me a TikTok video", "What's going out this week?"],
          placeholder: "Message Sage…",
          onWorkDone: refresh,
        }));

        var right = HL.el("div");
        right.style.cssText = "display:flex;flex-direction:column;gap:16px;min-width:0";
        right.appendChild(buildQueue(refresh));
        cols.appendChild(right);
        root.appendChild(cols);

        var cal = buildCalendar();
        cal.style.marginTop = "16px";
        root.appendChild(cal);

        var honest = HL.el("p", "sec-intro");
        honest.style.marginTop = "14px";
        honest.innerHTML = "Preview mode — the pipeline fires on schedule, live platform posting arrives with <a href='#/integrations' style='color:var(--accent);font-weight:600'>Integrations</a>.";
        root.appendChild(honest);

        return root;
      });
    },
  };
})();
