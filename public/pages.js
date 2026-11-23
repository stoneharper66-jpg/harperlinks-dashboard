/* HarperLinks Business OS — all dashboard pages except Social (social.js). */
(function () {
  "use strict";
  var HL = window.HL;
  var COLORS = ["#0A84FF", "#FF2D92", "#7B5CFF", "#16A34A"];

  /* ================= COMMAND CENTRE (home — open, boxless) ================= */
  var SUG_ICONS = {
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    film: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/></svg>',
  };

  var EMP_GREETS = {
    social: "Sage here — content's my thing. Posts, videos, the week's plan: say the word.",
    support: "Riley here — I handle customer questions from the knowledge base. Try me.",
    receptionist: "Harper here — bookings and messages. The phone line needs Twilio, but I book perfectly in chat.",
    sales: "Flynn here — leads and follow-ups. Tell me who's interested and I'll work them.",
    web: "Indi here — point me at a website and I'll learn the business or draft new page copy.",
    manager: "Darcy here — I watch the numbers. Ask what needs attention or what's coming up.",
  };

  /* ================= COMMAND CENTRE =================
     Answers four questions without a single click:
       1. What has my AI done?          (the brief + activity)
       2. What is it doing next?        (in flight)
       3. What actually needs me?       (attention)
       4. How is the business tracking? (numbers)
     The framing matters: this page reports what the team DID, rather
     than asking the owner what to do. The owner supervises; the AI works. */
  HL.pages.overview = {
    title: "Command Centre",
    render: function () {
      var q = (location.hash.split("?")[1] || "");
      var emp = (q.match(/emp=([a-z]+)/) || [])[1] || null;
      return Promise.all([HL.api("/api/profile"), HL.api("/api/employees")]).then(function (res) {
        var profile = res[0], emps = res[1];
        var empDef = emp ? emps.find(function (e) { return e.id === emp; }) : null;
        var root = HL.el("div", "cc");

        var logo = document.createElement("img");
        logo.src = "assets/logo-alpha.png";
        logo.alt = "";
        logo.className = "cc-logo";
        logo.setAttribute("aria-hidden", "true");
        root.appendChild(logo);

        var hr = new Date().getHours();
        var kick = hr < 12 ? "Good morning" : hr < 17 ? "Good arvo" : "Good evening";
        root.appendChild(HL.el("div", "cc-kicker", kick + " — your AI team is on."));

        var title = HL.el("h2", "cc-title");
        if (empDef) {
          title.innerHTML = "Talk to <span class=\"ttl-name\">" + HL.esc(empDef.name) + "</span>.";
        } else if (profile.configured) {
          title.innerHTML = "What should we get done, <span class=\"ttl-name\">" + HL.esc(profile.name.split(" ")[0]) + "</span>?";
        } else {
          title.innerHTML = "Where should we <span class=\"ttl-name\">start</span>?";
        }
        root.appendChild(title);

        var bench = HL.el("div", "cc-bench");

        if (empDef) {
          var sub = HL.el("p", "cc-sub", EMP_GREETS[empDef.id] || "");
          root.appendChild(sub);
        }

        var chat = HL.buildChat({
          bare: true,
          greet: null,
          employee: emp || undefined,
          bench: bench,
          placeholder: profile.configured ? "Tell your AI team what to do…" : "Paste your website, or just ask…",
          placeholders: profile.configured
            ? ["Tell your AI team what to do…", "Plan next week's content…", "Book Jane in for Tuesday 2pm…", "Script me a TikTok…", "Remind me to chase invoices Friday…"]
            : ["Paste your website, or just ask…", "Write me 5 posts for next week…", "Make me a TikTok video…", "Remind me to call Terry at 9am…"],
          onFirstSend: function () { root.classList.add("engaged"); },
        });

        // chat + composer live in one column so the composer docks at the bottom
        var main = HL.el("div", "cc-main");
        main.appendChild(chat);
        main.appendChild(chat.querySelector(".cc-compose"));
        root.appendChild(main);

        var sugs = HL.el("div", "cc-sugs");
        var items = profile.configured
          ? [
              ["pen", "Plan my week's content"],
              ["film", "Make me a TikTok video"],
              ["cal", "What's my day look like?"],
              ["bell", "Remind me to follow up new leads tomorrow 9am"],
            ]
          : [
              ["globe", "Learn my business from my website"],
              ["film", "Make me a TikTok video"],
              ["bell", "Remind me to call Terry tomorrow 9am"],
            ];
        items.forEach(function (it) {
          var b = HL.el("button", "cc-sug");
          b.innerHTML = SUG_ICONS[it[0]] + "<span>" + HL.esc(it[1]) + "</span>";
          b.addEventListener("click", function () {
            chat._send(it[1] === "Learn my business from my website" ? "Ingest my website" : it[1]);
          });
          sugs.appendChild(b);
        });
        if (empDef) sugs.style.display = "none";
        root.appendChild(sugs);

        // the team, linked — glowing when active; click to talk to that bot
        var strip = HL.el("div", "cc-team");
        emps.forEach(function (e, ei) {
          var cell = HL.el("div", "cc-team-cell");
          cell.style.animationDelay = (0.06 * ei) + "s";
          var b = HL.el("button", "cc-team-m" + (e.enabled ? " on" : "") + (emp === e.id ? " sel" : ""));
          b.title = e.name + " — " + e.role + (e.enabled ? "" : " (off)");
          b.innerHTML = '<span class="tm-ring"></span>' +
            (HL.botFace ? '<span class="tm-face">' + HL.botFace(e.id) + "</span>"
                        : '<span class="tm-init">' + HL.esc(e.name.charAt(0)) + "</span>");
          b.addEventListener("click", function () { location.hash = "#/employee?emp=" + e.id; });
          cell.appendChild(b);
          var who = HL.el("span", "tm-name", e.name);
          cell.appendChild(who);
          cell.appendChild(HL.el("span", "tm-role", e.role));
          strip.appendChild(cell);
        });
        var stripWrap = HL.el("div", "cc-teamwrap");
        stripWrap.appendChild(HL.el("div", "cc-teamlabel", "Your AI team"));
        stripWrap.appendChild(strip);
        root.appendChild(stripWrap);

        root.appendChild(bench);

        // One quiet line, only when something genuinely blocks the automation —
        // not a dashboard, just the next step.
        HL.api("/api/connections").then(function (conn) {
          var nudges = [];
          if (!profile.configured) {
            nudges.push(["Teach the team your business", "Ingest my website"]);
          } else if (conn && (!conn.configured || !conn.platforms.length)) {
            nudges.push(["Socials not connected — posts run as previews", "#/integrations"]);
          }
          if (!nudges.length || empDef) return;
          var bar = HL.el("div", "cc-nudges");
          nudges.forEach(function (n) {
            var b = HL.el("button", "cc-nudge", n[0]);
            b.addEventListener("click", function () {
              if (n[1].charAt(0) === "#") location.hash = n[1].slice(1);
              else chat._send(n[1]);
            });
            bar.appendChild(b);
          });
          root.insertBefore(bar, stripWrap);
        }).catch(function () {});

        return root;
      });
    },
  };

  /* ================= AI EMPLOYEES — boxless roster ================= */
  HL.pages.employees = {
    title: "AI Employees",
    render: function () {
      return HL.api("/api/employees").then(function (emps) {
        var root = HL.el("div");
        var on = emps.filter(function (e) { return e.enabled; }).length;
        root.appendChild(HL.el("p", "sec-intro", on + " of " + emps.length + " on duty. Switch them on and choose how much freedom each one gets."));

        var grid = HL.el("div", "emp-grid");
        emps.forEach(function (e, i) {
          var card = HL.el("div", "emp-card" + (e.enabled ? " live" : "") + (e.ready ? "" : " pending"));
          card.style.animationDelay = (0.05 * i) + "s";

          var top = HL.el("div", "emp-top");
          var av = HL.el("div", "emp-av emp-face" + (e.enabled ? " on" : ""));
          // their own pixel face, in their own colour (falls back to the initial)
          if (HL.botFace) av.innerHTML = HL.botFace(e.id);
          else av.textContent = e.name.charAt(0);
          top.appendChild(av);
          var who = HL.el("div", "emp-who");
          who.appendChild(HL.el("div", "emp-name", e.name));
          who.appendChild(HL.el("div", "emp-role", e.role));
          top.appendChild(who);
          var pulse = HL.el("span", "emp-state " + (e.enabled ? "ok" : e.ready ? "off" : "wait"),
            e.enabled ? "On duty" : e.ready ? "Paused" : "Setup needed");
          top.appendChild(pulse);
          card.appendChild(top);

          card.appendChild(HL.el("p", "emp-desc", e.description));

          var caps = HL.el("div", "emp-caps");
          (e.capabilities || []).slice(0, 4).forEach(function (c) {
            caps.appendChild(HL.el("span", "emp-cap", c));
          });
          card.appendChild(caps);

          if (!e.ready && (e.needs || []).length) {
            var need = HL.el("div", "emp-need");
            need.textContent = "Needs " + e.needs[0];
            card.appendChild(need);
          }

          var foot = HL.el("div", "emp-foot");
          var modeSel = HL.select([
            { value: "assisted", label: "Assisted — ask me first" },
            { value: "supervised", label: "Supervised — tell me after" },
            { value: "autonomous", label: "Autonomous — just do it" },
          ], e.mode);
          modeSel.className = "select emp-mode";
          modeSel.addEventListener("change", function () {
            HL.post("/api/employees/" + e.id, { mode: modeSel.value }, "PATCH")
              .then(function () { HL.toast(e.name + " → " + modeSel.value); })
              .catch(function (err) { HL.toast(err.message, true); });
          });
          foot.appendChild(modeSel);

          var sw = HL.switchEl(e.enabled, function (isOn) {
            HL.post("/api/employees/" + e.id, { enabled: isOn }, "PATCH")
              .then(function () {
                card.classList.toggle("live", isOn);
                av.classList.toggle("on", isOn);
                pulse.className = "emp-state " + (isOn ? "ok" : e.ready ? "off" : "wait");
                pulse.textContent = isOn ? "On duty" : e.ready ? "Paused" : "Setup needed";
                HL.toast(e.name + (isOn ? " is on duty" : " paused"));
              })
              .catch(function (err) { HL.toast(err.message, true); });
          });
          foot.appendChild(sw);
          card.appendChild(foot);

          var acts = HL.el("div", "emp-acts");
          var chatB = HL.el("button", "btn ghost sm", "Talk to " + e.name);
          chatB.addEventListener("click", function () { location.hash = "#/employee?emp=" + e.id; });
          top.style.cursor = "pointer";
          top.addEventListener("click", function () { location.hash = "#/employee?emp=" + e.id; });
          acts.appendChild(chatB);
          var WORKSPACES = { social: "social", support: "inbox", receptionist: "phone", sales: "crm", web: "website", manager: "analytics" };
          var wsB = HL.el("button", "btn ghost sm", "Workspace");
          wsB.addEventListener("click", function () { location.hash = "#/" + (WORKSPACES[e.id] || "overview"); });
          acts.appendChild(wsB);
          card.appendChild(acts);

          grid.appendChild(card);
        });
        root.appendChild(grid);
        return root;
      });
    },
  };

  /* ================= ONE EMPLOYEE — their own office ================= */
  var EMP_CHIPS = {
    social: ["Write next week's posts", "What's performing best?", "Make me a TikTok video"],
    support: ["What would you tell a customer who asks about prices?", "What can't you answer yet?"],
    receptionist: ["What's booked this week?", "Book a test appointment tomorrow 10am"],
    sales: ["Which leads are going cold?", "Draft a follow-up for my newest lead"],
    web: ["How's our website looking?", "Research a competitor's site"],
    manager: ["How's the business going?", "Who's our competition?", "What should we do differently?"],
  };
  var EMP_GREET = {
    social: "I run your content — writing, pictures, the calendar, the lot. What do you want out there?",
    support: "I answer your customers from what your business has actually said. Ask me anything they'd ask.",
    receptionist: "I keep the diary. Bookings, availability, reminders — try me.",
    sales: "I watch your pipeline so nothing goes cold. Want a look at your leads?",
    web: "Your website's mine — I build it, change it, and keep it safe. What needs doing?",
    manager: "I keep the whole operation honest — numbers, insights, the rest of the team. What do you want to know?",
  };

  HL.pages.employee = {
    title: "AI Team",
    render: function () {
      var q = new URLSearchParams((location.hash.split("?")[1] || ""));
      var id = q.get("emp") || "manager";
      return HL.api("/api/employees").then(function (emps) {
        var e = emps.find(function (x) { return x.id === id; }) || emps[0];
        var root = HL.el("div", "emp-office");

        /* -- hero: who they are, working state, controls -- */
        var hero = HL.el("section", "empo-hero");
        var av = HL.el("div", "empo-face" + (e.enabled ? " working" : ""));
        if (HL.botFace) av.innerHTML = HL.botFace(e.id);
        hero.appendChild(av);
        var mid = HL.el("div", "empo-mid");
        mid.appendChild(HL.el("h2", "empo-name", e.name));
        mid.appendChild(HL.el("div", "empo-role", e.role));
        var st = HL.el("div", "empo-state " + (e.enabled ? "ok" : e.ready ? "off" : "wait"),
          e.enabled ? "On duty — working now" : e.ready ? "Paused" : "Needs " + ((e.needs || [])[0] || "setup"));
        mid.appendChild(st);
        hero.appendChild(mid);

        var ctl = HL.el("div", "empo-ctl");
        var modeSel = HL.select([
          { value: "assisted", label: "Ask me first" },
          { value: "supervised", label: "Tell me after" },
          { value: "autonomous", label: "Just do it" },
        ], e.mode);
        modeSel.className = "select";
        modeSel.addEventListener("change", function () {
          HL.post("/api/employees/" + e.id, { mode: modeSel.value }, "PATCH")
            .then(function () { HL.toast(e.name + " → " + modeSel.value); });
        });
        ctl.appendChild(modeSel);
        ctl.appendChild(HL.switchEl(e.enabled, function (isOn) {
          HL.post("/api/employees/" + e.id, { enabled: isOn }, "PATCH").then(function () {
            av.classList.toggle("working", isOn);
            st.className = "empo-state " + (isOn ? "ok" : "off");
            st.textContent = isOn ? "On duty — working now" : "Paused";
            HL.toast(e.name + (isOn ? " is on duty" : " paused"));
          });
        }));
        hero.appendChild(ctl);
        root.appendChild(hero);

        /* -- what they're for, in one line each -- */
        var caps = HL.el("div", "empo-caps");
        (e.capabilities || []).forEach(function (c) { caps.appendChild(HL.el("span", "emp-cap", c)); });
        root.appendChild(caps);

        /* -- the conversation IS the page -- */
        root.appendChild(HL.buildChat({
          tall: true,
          title: "Talk to " + e.name,
          hint: e.role,
          employee: e.id,
          greet: EMP_GREET[e.id] || e.description,
          chips: EMP_CHIPS[e.id] || [],
          placeholder: "Tell " + e.name + " what you need…",
        }));
        return root;
      });
    },
  };

  HL.pages.automations = {
    title: "Automations",
    render: function () {
      return Promise.all([HL.api("/api/workflows"), HL.api("/api/workflow-options")]).then(function (res) {
        var workflows = res[0], options = res[1];
        var root = HL.el("div");
        var intro = HL.el("p", "sec-intro");
        intro.innerHTML = "<b>When</b> something happens → <b>do</b> these steps. Local actions run for real; SMS/email wait for their integrations.";
        root.appendChild(intro);

        function builder(wf) {
          var body = HL.el("div");
          var name = HL.input("Workflow name, e.g. New lead follow-up", wf ? wf.name : "");
          var trig = HL.select(options.triggers.map(function (t) { return { value: t.id, label: t.label }; }), wf ? wf.trigger : options.triggers[0].id);
          body.appendChild(HL.field("Name", name));
          body.appendChild(HL.field("WHEN this happens…", trig));

          var actionsWrap = HL.el("div");
          body.appendChild(HL.field("…DO these steps", actionsWrap));
          var steps = [];
          function addStep(preset) {
            var rowEl = HL.el("div", "frow");
            rowEl.style.marginBottom = "8px";
            var sel = HL.select(options.actions.map(function (a) { return { value: a.id, label: a.label }; }), preset ? preset.type : options.actions[0].id);
            var note = HL.input("Optional note / message", preset ? preset.note || "" : "");
            var del = HL.el("button", "btn ghost sm", "✕");
            del.type = "button";
            del.addEventListener("click", function () {
              steps = steps.filter(function (s) { return s.row !== rowEl; });
              rowEl.remove();
            });
            rowEl.appendChild(sel); rowEl.appendChild(note); rowEl.appendChild(del);
            actionsWrap.appendChild(rowEl);
            steps.push({ row: rowEl, sel: sel, note: note });
          }
          (wf ? wf.actions : [null]).forEach(addStep);
          var addBtn = HL.el("button", "btn ghost sm", "+ Add step");
          addBtn.type = "button";
          addBtn.addEventListener("click", function () { addStep(); });
          body.appendChild(addBtn);

          HL.modal(wf ? "Edit workflow" : "New workflow", body, function () {
            var payload = {
              name: name.value.trim(),
              trigger: trig.value,
              actions: steps.map(function (s) { return { type: s.sel.value, note: s.note.value.trim() || undefined }; }),
            };
            if (!payload.name) { HL.toast("Give it a name", true); return true; }
            var req = wf ? HL.post("/api/workflows/" + wf.id, payload, "PATCH") : HL.post("/api/workflows", payload);
            return req.then(function () { HL.toast("Workflow saved"); HL.navigate(); });
          });
        }

        var head = HL.el("div");
        head.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:14px";
        var newBtn = HL.el("button", "btn", "+ New workflow");
        newBtn.addEventListener("click", function () { builder(null); });
        head.appendChild(newBtn);
        root.appendChild(head);

        if (!workflows.length) {
          var empty = HL.panel("No workflows yet", "");
          empty.appendChild(HL.emptyState("", "Try: \"New lead captured → add a follow-up + AI-draft an outreach message.\"", "+ Create it", function () { builder(null); }));
          root.appendChild(empty);
          return root;
        }

        var list = HL.el("div", "grid cols-2");
        workflows.forEach(function (wf) {
          var card = HL.panel(wf.name, "");
          var headEl = card.querySelector(".panel-head");
          headEl.appendChild(HL.switchEl(wf.enabled, function (on) {
            HL.post("/api/workflows/" + wf.id, { enabled: on }, "PATCH").then(function () { HL.toast(wf.name + (on ? " enabled" : " paused")); });
          }));
          var body = HL.el("div", "panel-body");
          var trigLabel = (options.triggers.find(function (t) { return t.id === wf.trigger; }) || {}).label || wf.trigger;
          var flow = HL.el("div");
          flow.style.cssText = "font-size:13px;color:var(--muted);line-height:1.7";
          flow.innerHTML = "<b style='color:var(--accent)'>WHEN</b> " + HL.esc(trigLabel) + "<br>" +
            wf.actions.map(function (a) {
              var def = options.actions.find(function (x) { return x.id === a.type; }) || { label: a.type, local: true };
              return "<b style='color:var(--accent2)'>DO</b> " + HL.esc(def.label) + (def.local ? "" : " <span class='pill-st amber'>needs " + HL.esc(def.needs || "integration") + "</span>");
            }).join("<br>");
          body.appendChild(flow);

          var runs = wf.runs || [];
          var runInfo = HL.el("div");
          runInfo.style.cssText = "margin-top:10px;font-size:12px;color:var(--dim)";
          if (runs.length) {
            var last = runs[runs.length - 1];
            var okAll = last.results.every(function (r) { return r.ok; });
            runInfo.innerHTML = runs.length + " run" + (runs.length > 1 ? "s" : "") + " · last " + HL.fmtWhen(last.at) + " " +
              (okAll ? "<span class='pill-st green'>ok</span>" : "<span class='pill-st amber'>partial</span>");
          } else {
            runInfo.textContent = "Never run yet";
          }
          body.appendChild(runInfo);

          var acts = HL.el("div");
          acts.style.cssText = "display:flex;gap:8px;margin-top:12px";
          var test = HL.el("button", "btn ghost sm", "Test run");
          test.addEventListener("click", function () {
            HL.post("/api/workflows/" + wf.id + "/test", {}).then(function () { HL.toast("Test fired — check the activity feed"); HL.navigate(); });
          });
          var edit = HL.el("button", "btn ghost sm", "Edit");
          edit.addEventListener("click", function () { builder(wf); });
          var del = HL.el("button", "btn danger sm", "Delete");
          del.addEventListener("click", function () {
            HL.api("/api/workflows/" + wf.id, { method: "DELETE" }).then(function () { HL.toast("Deleted"); HL.navigate(); });
          });
          acts.appendChild(test); acts.appendChild(edit); acts.appendChild(del);
          body.appendChild(acts);
          card.appendChild(body);
          list.appendChild(card);
        });
        root.appendChild(list);
        return root;
      });
    },
  };

  /* ================= CRM ================= */
  var LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
  HL.pages.crm = {
    title: "CRM & Leads",
    render: function () {
      return HL.api("/api/leads").then(function (leads) {
        var root = HL.el("div");

        var stats = HL.el("div", "grid cols-4");
        stats.appendChild(HL.stat("Total leads", leads.length, "all time"));
        stats.appendChild(HL.stat("Open pipeline", leads.filter(function (l) { return !["won", "lost"].includes(l.status); }).length, "being worked"));
        stats.appendChild(HL.stat("Won", leads.filter(function (l) { return l.status === "won"; }).length, "customers"));
        var overdue = leads.reduce(function (n, l) { return n + (l.followUps || []).filter(function (f) { return !f.done && new Date(f.due) < new Date(); }).length; }, 0);
        stats.appendChild(HL.stat("Overdue follow-ups", overdue, overdue ? "needs attention" : "all clear"));
        stats.style.marginBottom = "16px";
        root.appendChild(stats);

        function leadModal(lead) {
          var body = HL.el("div");
          var name = HL.input("Full name", lead ? lead.name : "");
          var phone = HL.input("Phone", lead ? lead.phone : "");
          var email = HL.input("Email", lead ? lead.email : "");
          var interest = HL.input("What are they interested in?", lead ? lead.interest : "");
          var row = HL.el("div", "frow");
          row.appendChild(HL.field("Name", name));
          row.appendChild(HL.field("Phone", phone));
          body.appendChild(row);
          var row2 = HL.el("div", "frow");
          row2.appendChild(HL.field("Email", email));
          row2.appendChild(HL.field("Interest", interest));
          body.appendChild(row2);
          var note = HL.input("Add a note (optional)");
          if (lead) body.appendChild(HL.field("New note", note));

          if (lead && (lead.notes || []).length) {
            var nl = HL.el("div");
            nl.style.cssText = "max-height:140px;overflow-y:auto;background:var(--card);border:1px solid var(--border);border-radius:11px;padding:10px 12px;font-size:12.5px;color:var(--muted)";
            lead.notes.slice().reverse().forEach(function (n) {
              var p = HL.el("p");
              p.style.margin = "0 0 8px";
              p.innerHTML = "<b style='font-size:11px'>" + HL.esc(n.by || "note") + " · " + HL.fmtWhen(n.at) + "</b><br>" + HL.esc(n.text);
              nl.appendChild(p);
            });
            body.appendChild(HL.field("Notes & AI drafts", nl));
          }

          HL.modal(lead ? lead.name : "New lead", body, function () {
            var payload = { name: name.value, phone: phone.value, email: email.value, interest: interest.value };
            if (lead && note.value.trim()) payload.note = note.value.trim();
            var req = lead ? HL.post("/api/leads/" + lead.id, payload, "PATCH") : HL.post("/api/leads", payload);
            return req.then(function () { HL.toast("Lead saved"); HL.navigate(); });
          });
        }

        var bar = HL.el("div");
        bar.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:12px";
        var add = HL.el("button", "btn", "+ New lead");
        add.addEventListener("click", function () { leadModal(null); });
        bar.appendChild(add);
        root.appendChild(bar);

        var board = HL.el("div", "kanban");
        LEAD_STAGES.forEach(function (stage) {
          var col = HL.el("div", "kcol");
          var head = HL.el("div", "kcol-head");
          head.appendChild(HL.el("span", null, stage));
          var inStage = leads.filter(function (l) { return l.status === stage; });
          head.appendChild(HL.el("i", null, String(inStage.length)));
          col.appendChild(head);
          inStage.forEach(function (l) {
            var card = HL.el("div", "kcard");
            card.appendChild(HL.el("div", "kname", l.name));
            if (l.interest) card.appendChild(HL.el("div", "kint", l.interest));
            var meta = HL.el("div", "kmeta");
            meta.appendChild(HL.el("span", null, "score " + l.score));
            meta.appendChild(HL.el("span", null, "· " + l.source));
            if ((l.followUps || []).some(function (f) { return !f.done && new Date(f.due) < new Date(); })) {
              meta.appendChild(HL.el("span", "pill-st amber", "follow up"));
            }
            card.appendChild(meta);
            var move = HL.el("div", "kmove");
            var si = LEAD_STAGES.indexOf(stage);
            if (si > 0) {
              var back = HL.el("button", null, "←");
              back.addEventListener("click", function (e) {
                e.stopPropagation();
                HL.post("/api/leads/" + l.id, { status: LEAD_STAGES[si - 1] }, "PATCH").then(HL.navigate);
              });
              move.appendChild(back);
            }
            if (si < LEAD_STAGES.length - 2) {
              var fwd = HL.el("button", null, "→");
              fwd.addEventListener("click", function (e) {
                e.stopPropagation();
                HL.post("/api/leads/" + l.id, { status: LEAD_STAGES[si + 1] }, "PATCH").then(HL.navigate);
              });
              move.appendChild(fwd);
            }
            if (!["won", "lost"].includes(stage)) {
              var w = HL.el("button", null, "Won");
              w.addEventListener("click", function (e) {
                e.stopPropagation();
                HL.post("/api/leads/" + l.id, { status: "won" }, "PATCH").then(HL.navigate);
              });
              move.appendChild(w);
            }
            card.appendChild(move);
            card.addEventListener("click", function () { leadModal(l); });
            col.appendChild(card);
          });
          board.appendChild(col);
        });
        root.appendChild(board);
        return root;
      });
    },
  };

  /* ================= APPOINTMENTS ================= */
  HL.pages.appointments = {
    title: "Appointments",
    render: function () {
      return HL.api("/api/appointments").then(function (appts) {
        var root = HL.el("div");

        function bookModal(appt) {
          var body = HL.el("div");
          var name = HL.input("Customer name", appt ? appt.customer_name : "");
          var phone = HL.input("Phone", appt ? appt.phone : "");
          var service = HL.input("Service / reason", appt ? appt.service : "");
          var when = HL.input("e.g. Tuesday 2pm, tomorrow 10am", "");
          var dur = HL.select([{value:30,label:"30 min"},{value:60,label:"1 hour"},{value:90,label:"1.5 hours"},{value:120,label:"2 hours"}], appt ? appt.durationMinutes : 60);
          var r1 = HL.el("div", "frow"); r1.appendChild(HL.field("Customer", name)); r1.appendChild(HL.field("Phone", phone));
          body.appendChild(r1);
          var r2 = HL.el("div", "frow"); r2.appendChild(HL.field("Service", service)); r2.appendChild(HL.field("Duration", dur));
          body.appendChild(r2);
          body.appendChild(HL.field(appt ? "New time (leave blank to keep " + HL.fmtWhen(appt.startsAt) + ")" : "When", when));

          HL.modal(appt ? "Reschedule / edit" : "Book appointment", body, function () {
            if (appt) {
              var patch = {};
              if (when.value.trim()) patch.when = when.value.trim();
              return HL.post("/api/appointments/" + appt.id, patch, "PATCH").then(function () { HL.toast("Updated"); HL.navigate(); });
            }
            return HL.post("/api/appointments", {
              customer_name: name.value, phone: phone.value, service: service.value,
              when: when.value, durationMinutes: parseInt(dur.value, 10),
            }).then(function () { HL.toast("Booked ✓"); HL.navigate(); });
          }, appt ? "Save" : "Book it");
        }

        var bar = HL.el("div");
        bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap";
        var note = HL.el("p", "sec-intro");
        note.style.margin = "0";
        note.innerHTML = "The AI books into this calendar and checks clashes first.";
        bar.appendChild(note);
        var add = HL.el("button", "btn", "+ Book appointment");
        add.addEventListener("click", function () { bookModal(null); });
        bar.appendChild(add);
        root.appendChild(bar);

        // month calendar with events
        var cal = HL.panel("Calendar", "");
        var calBody = HL.el("div", "panel-body");
        cal.appendChild(calBody);
        var cursor = new Date(); cursor.setDate(1);
        var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        function renderCal() {
          calBody.innerHTML = "";
          var head = HL.el("div");
          head.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px";
          head.appendChild(HL.el("strong", null, MONTHS[cursor.getMonth()] + " " + cursor.getFullYear()));
          var nb = HL.el("div");
          ["‹", "›"].forEach(function (s, i) {
            var b = HL.el("button", "btn ghost sm", s);
            b.style.marginLeft = "6px";
            b.addEventListener("click", function () { cursor.setMonth(cursor.getMonth() + (i ? 1 : -1)); renderCal(); });
            nb.appendChild(b);
          });
          head.appendChild(nb);
          calBody.appendChild(head);
          var grid = HL.el("div", "bigcal-grid");
          ["Mo","Tu","We","Th","Fr","Sa","Su"].forEach(function (d) { grid.appendChild(HL.el("div", "bigcal-dow", d)); });
          var y = cursor.getFullYear(), m = cursor.getMonth();
          var off = (new Date(y, m, 1).getDay() + 6) % 7;
          var days = new Date(y, m + 1, 0).getDate();
          var today = new Date();
          for (var i = 0; i < off; i++) grid.appendChild(HL.el("div", "bigcal-day dim"));
          for (var d = 1; d <= days; d++) {
            var cell = HL.el("div", "bigcal-day");
            if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) cell.classList.add("today");
            cell.appendChild(HL.el("div", "dnum", String(d)));
            appts.filter(function (a) {
              if (a.status === "cancelled") return false;
              var ad = new Date(a.startsAt);
              return ad.getFullYear() === y && ad.getMonth() === m && ad.getDate() === d;
            }).slice(0, 3).forEach(function (a) {
              var ev = HL.el("div", "bigcal-ev" + (a.status === "completed" ? " grey" : ""));
              ev.textContent = HL.fmtTime(a.startsAt) + " " + a.customer_name;
              ev.title = a.service;
              cell.appendChild(ev);
            });
            grid.appendChild(cell);
          }
          calBody.appendChild(grid);
        }
        renderCal();
        root.appendChild(cal);

        // upcoming list
        var up = HL.panel("Upcoming & recent", "");
        up.style.marginTop = "16px";
        var tbl = document.createElement("table");
        tbl.className = "tbl";
        tbl.innerHTML = "<thead><tr><th>Customer</th><th>Service</th><th>When</th><th>Status</th><th></th></tr></thead>";
        var tb = document.createElement("tbody");
        var sorted = appts.slice().sort(function (a, b) { return new Date(b.startsAt) - new Date(a.startsAt); });
        if (!sorted.length) {
          up.appendChild(HL.emptyState("", "No appointments yet — book one or ask the bot: \"book Jane for a consult Tuesday 2pm\".", "+ Book one", function () { bookModal(null); }));
        } else {
          sorted.slice(0, 15).forEach(function (a) {
            var tr = document.createElement("tr");
            tr.innerHTML = "<td><b>" + HL.esc(a.customer_name) + "</b></td><td>" + HL.esc(a.service) + "</td><td>" + HL.fmtWhen(a.startsAt) + "</td>" +
              "<td><span class='pill-st " + a.status + "'>" + a.status + "</span></td><td></td>";
            var td = tr.lastChild;
            if (a.status === "booked") {
              var re = HL.el("button", "btn ghost sm", "Edit");
              re.addEventListener("click", function () { bookModal(a); });
              td.appendChild(re);
              var cx = HL.el("button", "btn danger sm", "Cancel");
              cx.style.marginLeft = "6px";
              cx.addEventListener("click", function () {
                HL.post("/api/appointments/" + a.id, { status: "cancelled" }, "PATCH").then(function () { HL.toast("Cancelled"); HL.navigate(); });
              });
              td.appendChild(cx);
            }
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          up.appendChild(tbl);
        }
        root.appendChild(up);
        return root;
      });
    },
  };

  /* ================= WEBSITE MANAGER ================= */
  HL.pages.website = {
    title: "Website Manager",
    render: function () {
      return Promise.all([HL.api("/api/website"), HL.api("/api/profile")]).then(function (res) {
        var site = res[0], profile = res[1];
        var root = HL.el("div", "wsite");
        var isBuilt = site.mode === "built" && (site.hasDraft || site.published);
        var isExternal = site.mode === "external" && site.externalUrl;

        /* ================= header: what this is, and its state ================= */
        var head = HL.el("div", "whead");
        var hl = HL.el("div", "whead-l");
        hl.appendChild(HL.el("h2", "whead-title", isBuilt ? (site.title || "Your website") : isExternal ? "Your website" : "Your website"));
        var statusText = isBuilt
          ? (site.hasDraft ? "Draft — not live yet" : "Live · published " + HL.fmtWhen(site.publishedAt))
          : isExternal ? "Linked — hosted elsewhere"
          : "Not set up yet";
        var chip = HL.el("span", "wchip " + (isBuilt ? (site.hasDraft ? "draft" : "live") : isExternal ? "ext" : "none"), statusText);
        hl.appendChild(chip);
        if (isBuilt && site.hasDraft && site.published) {
          hl.appendChild(HL.el("span", "wchip live", "Previous version still live"));
        }
        head.appendChild(hl);

        /* device switcher — only meaningful when there's something to preview */
        var currentDevice = "desktop";
        var viewport;
        if (isBuilt || isExternal) {
          var devices = HL.el("div", "wdevs");
          [["desktop", "Desktop", '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'],
           ["tablet", "Tablet", '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18.5h2"/></svg>'],
           ["phone", "Phone", '<svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18.5h2"/></svg>']
          ].forEach(function (d) {
            var b = HL.el("button", "wdev" + (d[0] === "desktop" ? " on" : ""));
            b.type = "button";
            b.title = d[1];
            b.innerHTML = d[2];
            b.addEventListener("click", function () {
              currentDevice = d[0];
              devices.querySelectorAll(".wdev").forEach(function (x) { x.classList.remove("on"); });
              b.classList.add("on");
              viewport.className = "wview dev-" + d[0];
            });
            devices.appendChild(b);
          });
          head.appendChild(devices);
        }
        root.appendChild(head);

        /* ================= the preview stage ================= */
        var stage = HL.el("div", "wstage");
        var bar = HL.el("div", "wbar");
        var dots = HL.el("div", "wdots");
        dots.innerHTML = "<i></i><i></i><i></i>";
        bar.appendChild(dots);
        var addr = HL.el("div", "waddr");
        bar.appendChild(addr);
        var barActions = HL.el("div", "wbar-act");
        bar.appendChild(barActions);
        stage.appendChild(bar);

        viewport = HL.el("div", "wview dev-desktop");
        stage.appendChild(viewport);

        var frame = null;
        function shimmer() {
          viewport.classList.remove("refreshing");
          void viewport.offsetWidth;          // restart the animation
          viewport.classList.add("refreshing");
          setTimeout(function () { viewport.classList.remove("refreshing"); }, 950);
        }
        function reloadFrame() {
          if (!frame) return;
          shimmer();
          frame.src = (isBuilt ? site.publicPath : site.externalUrl) + (isBuilt ? "?t=" + Date.now() : "");
        }

        function iconBtn(label, svg, fn) {
          var b = HL.el("button", "wact");
          b.type = "button";
          b.title = label;
          b.setAttribute("aria-label", label);
          b.innerHTML = svg;
          b.addEventListener("click", fn);
          return b;
        }
        var IC_REFRESH = '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/></svg>';
        var IC_OPEN = '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>';

        if (isBuilt) {
          var previewSrc = site.hasDraft ? "/api/website/draft" : site.publicPath;
          addr.textContent = site.hasDraft ? "draft preview — only you can see this" : location.origin + site.publicPath;
          frame = document.createElement("iframe");
          frame.className = "wframe";
          frame.src = previewSrc + "?t=" + Date.now();
          frame.title = site.hasDraft ? "Draft preview of your website" : "Live preview of your website";
          viewport.appendChild(frame);
          shimmer();
          barActions.appendChild(iconBtn("Refresh preview", IC_REFRESH, function () {
            shimmer(); frame.src = previewSrc + "?t=" + Date.now();
          }));
          if (site.published && site.publicPath) {
            var openA = HL.el("a", "wact");
            openA.href = site.publicPath; openA.target = "_blank"; openA.rel = "noopener";
            openA.title = "Open the live page"; openA.innerHTML = IC_OPEN;
            barActions.appendChild(openA);
          }
        } else if (isExternal) {
          addr.textContent = site.externalUrl;
          frame = document.createElement("iframe");
          frame.className = "wframe";
          frame.src = site.externalUrl;
          frame.title = "Preview of your website";
          viewport.appendChild(frame);
          var warn = HL.el("div", "wblocked");
          warn.innerHTML = "Blank? Your website blocks being shown inside other pages — that's a setting on their end, not a fault here. Use the open button, or ask your AI team to build you a HarperLinks page.";
          viewport.appendChild(warn);
          var openB = HL.el("a", "wact");
          openB.href = site.externalUrl; openB.target = "_blank"; openB.rel = "noopener";
          openB.title = "Open in a new tab"; openB.innerHTML = IC_OPEN;
          barActions.appendChild(openB);
        } else {
          addr.textContent = "No website yet";
          var empty = HL.el("div", "wempty");
          empty.innerHTML =
            '<div class="we-ic">◧</div>' +
            "<h3>Let's build you a website</h3>" +
            "<p>Your AI team writes the whole thing — hero, what you do, why people choose you, how to reach you — using what it knows about your business. About a minute.</p>";
          var mk = HL.el("button", "btn", "Build it now");
          mk.addEventListener("click", function () { askAI("Build me a website for my business"); });
          empty.appendChild(mk);
          viewport.appendChild(empty);
        }
        root.appendChild(stage);

        /* ================= scan & publish ================= */
        if (isBuilt) {
          var pubRow = HL.el("div", "wpub");
          var scanBtn = HL.el("button", "btn ghost", "Security scan");
          var pubBtn = HL.el("button", "btn", site.hasDraft ? "Publish to the web" : "Published ✓");
          if (!site.hasDraft) pubBtn.disabled = true;

          // one compact line: sweep animation while scanning, then the verdict
          var line = HL.el("div", "wscan-line");
          var details = HL.el("div", "wscan-details");
          var lastReport = null;

          var SCAN_WORDS = ["Checking scripts…", "Checking links…", "Checking embedded content…", "Checking forms…", "Checking SEO & accessibility…"];
          function animateScan(fetcher, after) {
            line.className = "wscan-line running";
            details.classList.remove("on");
            line.innerHTML = '<span class="wsl-bar"></span><span class="wsl-text">' + SCAN_WORDS[0] + "</span>";
            var wi = 0;
            var cycler = setInterval(function () {
              wi = (wi + 1) % SCAN_WORDS.length;
              var t = line.querySelector(".wsl-text");
              if (t) t.textContent = SCAN_WORDS[wi];
            }, 420);
            var t0 = Date.now();
            fetcher().then(function (rep) {
              // let the sweep play at least ~1.5s so the scan reads as a scan
              setTimeout(function () {
                clearInterval(cycler);
                showLine(rep);
                if (after) after(rep, null);
              }, Math.max(0, 1500 - (Date.now() - t0)));
            }).catch(function (e) {
              clearInterval(cycler);
              line.className = "wscan-line bad";
              line.textContent = e.message;
              if (after) after(null, e);
            });
          }

          function showLine(rep) {
            lastReport = rep;
            var fails = rep.checks.filter(function (c) { return !c.ok; });
            line.className = "wscan-line " + (rep.publishable ? (rep.qualFails ? "warn" : "ok") : "bad");
            var msg = rep.publishable
              ? (rep.qualFails
                ? "✓ " + rep.score + "% — safe to publish · " + rep.qualFails + " quality tip" + (rep.qualFails > 1 ? "s" : "")
                : "✓ " + rep.score + "% — perfect, every check passed")
              : "✗ " + rep.secFails + " security issue" + (rep.secFails > 1 ? "s" : "") + " block publishing";
            line.innerHTML = '<span class="wsl-text">' + HL.esc(msg) + "</span>" +
              '<span class="wsl-free">scans are free</span>';
            if (fails.length) {
              var fix = HL.el("button", "btn sm wsl-fix", "Fix with AI");
              fix.addEventListener("click", function () {
                askAI("The security scan found these problems — fix every one of them in the website draft: " +
                  fails.map(function (c) { return c.label + " (" + (c.detail || "fix this") + ")"; }).join("; "));
              });
              line.appendChild(fix);
              var tog = HL.el("button", "wsl-more", "details");
              tog.addEventListener("click", function () { details.classList.toggle("on"); });
              line.appendChild(tog);
              details.innerHTML = "";
              fails.forEach(function (c) {
                var r = HL.el("div", "wscan-row fail");
                r.innerHTML = '<span class="wsc-bad">✗</span><span>' + HL.esc(c.label) + " <em>" + HL.esc(c.detail) + "</em></span>";
                details.appendChild(r);
              });
            }
          }

          scanBtn.addEventListener("click", function () {
            scanBtn.disabled = true;
            animateScan(function () { return HL.api("/api/website/scan"); }, function () { scanBtn.disabled = false; });
          });

          pubBtn.addEventListener("click", function () {
            pubBtn.disabled = true; pubBtn.textContent = "Scanning & publishing…";
            var job = HL.jobStart ? HL.jobStart("website", "Publishing your website") : null;
            animateScan(function () {
              return HL.post("/api/website/publish", {}).then(function (out) { return out.report; });
            }, function (rep, err) {
              if (err) {
                if (job) HL.jobDone(job, "Publish blocked — fix the security issues", false);
                pubBtn.disabled = false; pubBtn.textContent = "Publish to the web";
                HL.api("/api/website/scan").then(showLine).catch(function () {});
                return;
              }
              if (job) HL.jobDone(job, "Website published — it's live", true);
              stage.classList.add("landed");
              setTimeout(function () { HL.navigate(); }, 1500);
            });
          });

          pubRow.appendChild(scanBtn);
          pubRow.appendChild(pubBtn);
          root.appendChild(pubRow);
          root.appendChild(line);
          root.appendChild(details);
        }

        /* ================= ask-for-a-change bar ================= */
        var askWrap = HL.el("div", "wask");
        var thinkRow = HL.el("div", "wask-think");
        askWrap.appendChild(thinkRow);

        var askForm = HL.el("form", "wask-form");
        var askInput = HL.input(isBuilt
          ? "Tell your AI team what to change…"
          : "Describe the site you want…");
        askInput.className = "input wask-input";
        var askBtn = HL.el("button", "btn", isBuilt ? "Make the change" : "Build it");
        askBtn.type = "submit";
        askForm.appendChild(askInput);
        askForm.appendChild(askBtn);
        askWrap.appendChild(askForm);

        var chips = HL.el("div", "wchips");
        (isBuilt
          ? ["Make the hero darker", "Add our opening hours", "Add a contact section", "Make it feel more premium"]
          : ["Build me a website", "Build a one-page site with my services", "Make me a landing page for bookings"]
        ).forEach(function (t) {
          var c = HL.el("button", "wchip-s", t);
          c.type = "button";
          c.addEventListener("click", function () { askAI(t); });
          chips.appendChild(c);
        });
        askWrap.appendChild(chips);
        root.appendChild(askWrap);

        var busy = false;
        function askAI(text) {
          if (busy || !text.trim()) return;
          busy = true;
          askBtn.disabled = true;
          askInput.value = "";
          thinkRow.innerHTML = "";
          thinkRow.classList.add("on");
          var head2 = HL.el("div", "wt-head");
          head2.innerHTML = '<span class="wt-dots"><i></i><i></i><i></i></span><span class="wt-label">Thinking…</span>';
          thinkRow.appendChild(head2);
          var steps = HL.el("div", "wt-steps");
          thinkRow.appendChild(steps);

          var waiting = {}, done = 0, settled = false;
          var job = HL.jobStart ? HL.jobStart("website", text.slice(0, 42)) : null;
          function label(t) { return (HL.STEP_LABELS && HL.STEP_LABELS[t]) || t.replace(/_/g, " "); }
          function finish(msg, ok) {
            settled = true;
            head2.querySelector(".wt-dots").remove();
            head2.querySelector(".wt-label").textContent = done ? "Did " + done + " step" + (done > 1 ? "s" : "") : "Done";
            var m = HL.el("div", "wt-reply" + (ok ? "" : " bad"), msg);
            thinkRow.appendChild(m);
            busy = false;
            askBtn.disabled = false;
            if (job) HL.jobDone(job, ok ? (done ? "Website updated — " + text.slice(0, 36) : "Answered") : "Couldn't finish: " + text.slice(0, 30), ok);
            if (ok && done) {
              stage.classList.add("landed");
              reloadFrame();
              var nowPage = (location.hash || "").replace(/^#\//, "").split("?")[0];
              if (nowPage === "website") setTimeout(function () { HL.navigate(); }, 1800);
            }
          }

          // the AI gets told where the request came from, so a bare "add our
          // hours" is understood as a change to this site, not a new topic
          var framed = "[Request from the Website page" +
            (isBuilt ? " — a HarperLinks-built site already exists; read it and edit it" : "") +
            "] " + text;
          HL.stream("/api/chat/stream", { sessionId: "website-" + HL.sessionId, message: framed, employee: "web" }, function (ev) {
            if (ev.phase === "model") head2.querySelector(".wt-label").textContent = "Thinking…";
            else if (ev.phase === "tool-start") {
              head2.querySelector(".wt-label").textContent = "Working…";
              if (job) HL.jobStep(job, label(ev.tool) + "…");
              var r = HL.el("div", "wt-step pending");
              r.innerHTML = '<span class="wt-spin"></span><span>' + HL.esc(label(ev.tool)) + "</span>";
              steps.appendChild(r);
              (waiting[ev.tool] = waiting[ev.tool] || []).push(r);
            } else if (ev.phase === "step") {
              var row = (waiting[ev.tool] || []).shift();
              if (!row) { row = HL.el("div", "wt-step"); steps.appendChild(row); }
              row.className = "wt-step";
              row.innerHTML = (ev.ok ? '<span class="wt-ok">✓</span>' : '<span class="wt-bad">!</span>') +
                "<span>" + HL.esc(label(ev.tool)) + "</span>";
              done++;
            } else if (ev.phase === "done") finish(ev.reply || "Done.", true);
            else if (ev.phase === "error") finish(ev.error, false);
          }).then(function () {
            if (!settled) finish("The connection dropped mid-change — nothing was lost, try again.", false);
          }).catch(function (e) {
            if (!settled) finish(e.message || "Couldn't reach your AI team.", false);
          });
        }
        askForm.addEventListener("submit", function (e) { e.preventDefault(); askAI(askInput.value); });

        /* ================= lower tools ================= */
        var tools = HL.el("div", "wtools");

        /* version history */
        if (isBuilt && site.versions && site.versions.length) {
          var hist = HL.panel("Earlier versions", "Every change is reversible");
          var hb = HL.el("div", "panel-body");
          site.versions.slice().reverse().forEach(function (v, i) {
            var realIndex = site.versions.length - 1 - i;
            var vr = HL.el("div", "wver");
            var vl = HL.el("div", "wver-l");
            vl.appendChild(HL.el("div", "wver-note", v.note || "earlier version"));
            vl.appendChild(HL.el("div", "wver-at", HL.fmtWhen(v.at)));
            vr.appendChild(vl);
            var rb = HL.el("button", "btn ghost sm", "Restore");
            rb.addEventListener("click", function () {
              rb.disabled = true; rb.textContent = "Restoring…";
              HL.post("/api/website/restore", { index: realIndex })
                .then(function () { HL.toast("Restored"); HL.navigate(); })
                .catch(function (err) { HL.toast(err.message, true); rb.disabled = false; rb.textContent = "Restore"; });
            });
            vr.appendChild(rb);
            hb.appendChild(vr);
          });
          hist.appendChild(hb);
          tools.appendChild(hist);
        }

        /* link an existing site */
        var linkCard = HL.panel(isExternal ? "Linked website" : "Already have a website?", "We'll preview it here and learn your voice from it");
        var lb = HL.el("div", "panel-body");
        var lrow = HL.el("div", "ingest-row");
        var lurl = HL.input(site.externalUrl || "https://yourbusiness.com");
        var lgo = HL.el("button", "ingest-btn", "Link & learn");
        lgo.addEventListener("click", function () {
          var v = lurl.value.trim();
          if (!v) return HL.toast("Paste a website address first.", true);
          lgo.disabled = true; lgo.textContent = "Learning…";
          HL.post("/api/website/link", { url: v })
            .then(function () { return HL.post("/api/ingest", { url: v }); })
            .then(function (out) { HL.toast("Linked and learned " + out.profile.name + " ✓"); HL.navigate(); })
            .catch(function (e) { HL.toast(e.message, true); lgo.disabled = false; lgo.textContent = "Link & learn"; });
        });
        lrow.appendChild(lurl); lrow.appendChild(lgo);
        lb.appendChild(lrow);
        if (isBuilt) {
          var note = HL.el("p", "wnote", "Linking an outside site replaces this preview. Your built page stays at its address and can be restored above.");
          lb.appendChild(note);
        }
        linkCard.appendChild(lb);
        tools.appendChild(linkCard);

        /* what the AI knows */
        var know = HL.panel("What your AI team knows", profile.configured ? "Learned " + HL.fmtDay(profile.ingestedAt) : "Nothing yet");
        var kb = HL.el("div", "panel-body");
        if (profile.configured) {
          [["Business", profile.name + " · " + profile.businessType],
           ["Tagline", profile.tagline || "—"],
           ["Audience", profile.audience || "—"],
           ["Voice", profile.tone || "—"]].forEach(function (f) {
            var r = HL.el("div", "pf-row");
            r.appendChild(HL.el("span", "pf-label", f[0]));
            r.appendChild(HL.el("span", "pf-val", f[1]));
            kb.appendChild(r);
          });
          if ((profile.services || []).length) {
            var r2 = HL.el("div", "pf-row");
            r2.appendChild(HL.el("span", "pf-label", "Services"));
            var tags = HL.el("div", "pf-tags");
            profile.services.forEach(function (sv) { tags.appendChild(HL.el("span", "pf-tag", sv)); });
            r2.appendChild(tags);
            kb.appendChild(r2);
          }
        } else {
          kb.appendChild(HL.el("p", "sec-intro", "Link your site above, or ask your AI team to build one — either way they'll write in your voice afterwards."));
        }
        know.appendChild(kb);
        tools.appendChild(know);

        root.appendChild(tools);
        return root;
      });
    },
  };

  HL.pages.analytics = {
    title: "Analytics",
    render: function () {
      var days = 30;
      var root = HL.el("div");
      function load() {
        return HL.api("/api/stats?days=" + days).then(function (stats) {
          root.innerHTML = "";
          var bar = HL.el("div");
          bar.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-bottom:14px";
          [7, 30, 90].forEach(function (d) {
            var b = HL.el("button", "btn " + (d === days ? "" : "ghost") + " sm", "Last " + d + " days");
            b.addEventListener("click", function () { days = d; load(); });
            bar.appendChild(b);
          });
          root.appendChild(bar);

          var t = stats.totals;
          root.appendChild(HL.el("h3", "cmd-h", "Business performance"));
          var row = HL.el("div", "grid cols-4");
          row.appendChild(HL.stat("Leads", t.leads, t.conversion === null ? "no conversions yet" : t.conversion + "% convert to won"));
          row.appendChild(HL.stat("Appointments", t.appointments, t.upcoming + " upcoming"));
          row.appendChild(HL.stat("Posts published", t.postsPublished, "pipeline (preview mode)"));
          row.appendChild(HL.stat("Automation runs", stats.series.reduce(function (n, d) { return n + d.automations; }, 0), "in this period"));
          row.style.marginBottom = "16px";
          root.appendChild(row);

          /* -- what the AI team actually did, counted not claimed -- */
          Promise.all([HL.api("/api/activity"), HL.api("/api/budget"), HL.api("/api/tasks")]).then(function (xa) {
            var acts = xa[0] || [], bud = xa[1] || {}, tasks = xa[2] || [];
            var hdr = HL.el("h3", "cmd-h", "Your AI team's work");
            var row2 = HL.el("div", "grid cols-4");
            var byAI = acts.filter(function (a) { return ["content", "ingested", "research", "auto", "published"].indexOf(a.type) >= 0; });
            row2.appendChild(HL.stat("Actions logged", acts.length, "everything is auditable"));
            row2.appendChild(HL.stat("AI work items", byAI.length, "posts, scans, research, publishes"));
            row2.appendChild(HL.stat("Open tasks", tasks.filter(function (x) { return x.status !== "done"; }).length, "handed to you"));
            row2.appendChild(HL.stat("AI spend", "A$" + Number(bud.spent || 0).toFixed(2), "of A$" + Number(bud.cap || 50).toFixed(0) + " this month"));
            row2.style.marginBottom = "16px";
            root.insertBefore(row2, row.nextSibling);
            root.insertBefore(hdr, row2);
          }).catch(function () {});

          var c1 = HL.panel("Growth", "Leads & appointments per day");
          c1.appendChild(HL.lineChart(stats.series, ["leads", "appointments"], COLORS));
          c1.appendChild(HL.legend(["Leads", "Appointments"], COLORS));
          root.appendChild(c1);

          var c2 = HL.panel("Content", "Posts published & scheduled per day");
          c2.style.marginTop = "16px";
          c2.appendChild(HL.lineChart(stats.series, ["published", "scheduled"], [COLORS[1], COLORS[2]]));
          c2.appendChild(HL.legend(["Published", "Scheduled"], [COLORS[1], COLORS[2]]));
          root.appendChild(c2);

          /* -- what's working: the learning loop, honest about its data -- */
          var ip = HL.panel("What's working", "The team reads this and shapes new content toward it");
          ip.style.marginTop = "16px";
          HL.api("/api/insights").then(function (out) {
            var ins = out.insights, comps = out.competitors || [];
            if (ins.hasData) {
              var grid = HL.el("div", "ins-grid");
              [["Best post types", ins.byKind], ["Best platforms", ins.byPlatform], ["Best times", ins.byHour]].forEach(function (pair) {
                var col = HL.el("div", "ins-col");
                col.appendChild(HL.el("div", "ins-h", pair[0]));
                pair[1].slice(0, 3).forEach(function (r, i) {
                  var row = HL.el("div", "ins-row" + (i === 0 ? " win" : ""));
                  row.innerHTML = "<span>" + HL.esc(r.key) + "</span><b>" + r.avg + "</b>";
                  col.appendChild(row);
                });
                grid.appendChild(col);
              });
              ip.appendChild(grid);
            }
            (ins.recommendations || []).forEach(function (t) {
              var r = HL.el("div", "ins-reco");
              r.innerHTML = "<span class='ins-spark'>✦</span>" + HL.esc(t);
              ip.appendChild(r);
            });

            /* -- competitors: researched from their real websites -- */
            var cp = HL.panel("Competition", "The team reads their actual websites — nothing invented");
            cp.style.marginTop = "16px";
            var addRow = HL.el("form", "comp-add");
            var cu = HL.input("competitor-website.com.au");
            var cb = HL.el("button", "btn sm", "Study them");
            cb.type = "submit";
            addRow.appendChild(cu); addRow.appendChild(cb);
            addRow.addEventListener("submit", function (ev) {
              ev.preventDefault();
              if (!cu.value.trim()) return;
              cb.disabled = true; cb.textContent = "Reading their site…";
              HL.post("/api/competitors", { url: cu.value.trim() })
                .then(function () { HL.toast("Studied them"); HL.navigate(); })
                .catch(function (e2) { HL.toast(e2.message, true); cb.disabled = false; cb.textContent = "Study them"; });
            });
            cp.appendChild(addRow);
            if (!comps.length) {
              cp.appendChild(HL.el("p", "sec-intro", "No competitors studied yet. Paste one's website above, or just ask Darcy \"who's our competition?\""));
            }
            comps.forEach(function (c) {
              var card = HL.el("div", "comp-card");
              card.innerHTML = "<div class='comp-head'><b>" + HL.esc(c.name) + "</b><span>" + HL.esc(c.url) + " · " + c.pagesRead + " pages read</span></div>" +
                "<div class='comp-offer'>" + HL.esc(c.offer || "") + "</div>" +
                ((c.gaps || []).length ? "<div class='comp-gaps'>" + c.gaps.map(function (g) { return "<span>" + HL.esc(g) + "</span>"; }).join("") + "</div>" : "") +
                (c.takeaway ? "<div class='comp-take'>✦ " + HL.esc(c.takeaway) + "</div>" : "");
              cp.appendChild(card);
            });
            root.appendChild(cp);
          }).catch(function () {});
          root.appendChild(ip);

          var missing = HL.el("p", "sec-intro");
          missing.style.marginTop = "14px";
          missing.innerHTML = "Revenue, calls and email unlock when their <a href='#/integrations' style='color:var(--accent);font-weight:600'>integrations</a> connect. Only ever real data.";
          root.appendChild(missing);
          return root;
        });
      }
      return load();
    },
  };

  /* ================= INTEGRATIONS — boxless list ================= */
  HL.pages.integrations = {
    title: "Integrations",
    render: function () {
      var isAdmin = HL.user && HL.user.role === "admin";
      var reqs = [HL.api("/api/integrations"), HL.api("/api/connectors").catch(function () { return []; })];
      if (isAdmin) reqs.push(HL.api("/api/ghl/connect-info").catch(function () { return null; }));
      return Promise.all(reqs).then(function (out) {
        var ints = out[0], conns = out[1], ci = out[2];
        var root = HL.el("div");
        root.appendChild(HL.el("p", "sec-intro", "Nothing shows connected unless it really is."));

        // Stone's fast lane: one click into this account's publishing engine
        // to link socials, one click to re-check. Customers never see this.
        if (isAdmin) {
          var fast = HL.el("div", "admin-connect");
          var txt = HL.el("div");
          txt.innerHTML = ci && ci.configured
            ? "<b>Team fast-connect</b><span>Open the publishing engine, link the socials in its Social Planner, then re-check — the rows below flip green on their own.</span>"
            : "<b>Team fast-connect</b><span>No publishing engine on this account yet — add the token in Customer Accounts first.</span>";
          fast.appendChild(txt);
          var btns = HL.el("div", "ac-btns");
          if (ci && ci.configured) {
            var open = HL.el("a", "btn sm", "Open connect window ↗");
            open.href = ci.url; open.target = "_blank"; open.rel = "noopener";
            btns.appendChild(open);
          }
          var recheck = HL.el("button", "btn ghost sm", "Re-check status");
          recheck.addEventListener("click", function () { HL.toast("Checking all connections…"); HL.navigate(); });
          btns.appendChild(recheck);
          fast.appendChild(btns);
          root.appendChild(fast);
        }
        var list = HL.el("div", "rowlist");
        list.style.maxWidth = "720px";
        list.style.margin = "0 auto";
        ints.forEach(function (it) {
          var row = HL.el("div", "lrow");
          if (HL.BRAND_ICONS[it.id]) {
            var ic = HL.el("div", "brand-ic" + (it.connected ? " on" : ""));
            ic.innerHTML = HL.BRAND_ICONS[it.id];
            row.appendChild(ic);
          } else {
            row.appendChild(HL.el("div", "mono" + (it.connected ? " on" : ""), it.name.charAt(0)));
          }
          var main = HL.el("div", "lmain");
          main.appendChild(HL.el("div", "lname", it.name));
          main.appendChild(HL.el("div", "lsub", it.desc));
          // live status straight from the provider (why it's not connected, or
          // what it can actually reach) — only present for checks we really run
          if (it.detail) {
            var d = HL.el("div", "lsub", it.detail);
            d.style.cssText = "margin-top:3px;opacity:.75;font-size:12.5px";
            main.appendChild(d);
          }
          row.appendChild(main);
          var ctl = HL.el("div", "lctl");
          // Honest controls only. A "Connect" button that opens a "coming
          // soon" note is a fake button — so integrations that don't exist
          // yet say "Coming soon" outright, and the ones the team wires up
          // for you say exactly that.
          var comingSoon = /coming soon/i.test(it.how || "");
          if (it.connected) {
            ctl.appendChild(HL.el("span", "pill-st connected", "connected"));
          } else if (comingSoon) {
            ctl.appendChild(HL.el("span", "pill-st grey", "coming soon"));
          } else {
            var b = HL.el("button", "btn ghost sm", "How to connect");
            b.addEventListener("click", function () {
              var body = HL.el("div");
              var p = HL.el("p", null, it.how);
              p.style.cssText = "color:var(--muted);font-size:13.5px;line-height:1.6";
              body.appendChild(p);
              HL.modal("Connect " + it.name, body);
            });
            ctl.appendChild(b);
          }
          row.appendChild(ctl);
          list.appendChild(row);
        });
        root.appendChild(list);

        /* ---- your own connectors (webhooks) ---- */
        var ch = HL.el("div");
        ch.style.cssText = "max-width:720px;margin:26px auto 10px;display:flex;align-items:center;justify-content:space-between;gap:10px";
        var chT = HL.el("div");
        chT.innerHTML = "<b style='font-size:14.5px'>Your connectors</b><div style='font-size:12.5px;color:var(--muted);margin-top:2px'>Point HarperLinks at any webhook — Zapier, Make, n8n, your own site — and workflows can send events to it.</div>";
        ch.appendChild(chT);
        var addC = HL.el("button", "btn sm", "+ Add connector");
        addC.addEventListener("click", function () {
          var body = HL.el("div");
          var nm = HL.input("Name — e.g. Zapier leads hook");
          var url = HL.input("https://hooks.zapier.com/…");
          var sec = HL.input("Signing secret (optional)");
          var note = HL.el("p", null, "Workflows POST the event as JSON. With a secret set, every delivery is signed (X-HarperLinks-Signature, HMAC-SHA256) so the other end can verify it's really you.");
          note.style.cssText = "color:var(--muted);font-size:12.5px;line-height:1.55";
          body.appendChild(HL.field("Name", nm));
          body.appendChild(HL.field("Webhook URL", url));
          body.appendChild(HL.field("Secret", sec));
          body.appendChild(note);
          HL.modal("Add connector", body, function () {
            return HL.post("/api/connectors", { name: nm.value, url: url.value, secret: sec.value })
              .then(function () { HL.toast("Connector added — hit Test to check it"); HL.navigate(); });
          }, "Add");
        });
        ch.appendChild(addC);
        root.appendChild(ch);

        var clist = HL.el("div", "rowlist");
        clist.style.cssText = "max-width:720px;margin:0 auto";
        if (!conns.length) {
          var ce = HL.el("div", "lsub");
          ce.style.cssText = "max-width:720px;margin:4px auto 0;text-align:center;padding:16px;border:1.5px dashed var(--border);border-radius:14px";
          ce.textContent = "No connectors yet — add one and it becomes a workflow step: \"Send the event to …\"";
          clist.appendChild(ce);
        }
        conns.forEach(function (c) {
          var row = HL.el("div", "lrow");
          row.appendChild(HL.el("div", "mono on", "⟐"));
          var main = HL.el("div", "lmain");
          main.appendChild(HL.el("div", "lname", c.name));
          var ls = c.lastStatus;
          var stText = !ls ? "never fired yet"
            : ls.ok ? "last delivery worked (HTTP " + ls.code + ") · " + HL.fmtWhen(ls.at)
            : "last delivery FAILED — " + (ls.error || "") + " · " + HL.fmtWhen(ls.at);
          main.appendChild(HL.el("div", "lsub", c.host + (c.hasSecret ? " · signed" : "") + " · " + stText));
          row.appendChild(main);
          var ctl = HL.el("div", "lctl");
          ctl.style.cssText = "display:flex;gap:7px";
          var tBtn = HL.el("button", "btn ghost sm", "Test");
          tBtn.addEventListener("click", function () {
            tBtn.disabled = true; tBtn.textContent = "Testing…";
            HL.post("/api/connectors/" + c.id + "/test").then(function (o) {
              HL.toast(o.ok ? "Delivered — HTTP " + o.code : "Failed: " + o.error, !o.ok);
              HL.navigate();
            }).catch(function (e) { HL.toast(e.message, true); HL.navigate(); });
          });
          ctl.appendChild(tBtn);
          var rBtn = HL.el("button", "btn ghost sm", "Remove");
          rBtn.addEventListener("click", function () {
            HL.api("/api/connectors/" + c.id, { method: "DELETE" }).then(function () { HL.toast("Connector removed"); HL.navigate(); });
          });
          ctl.appendChild(rBtn);
          row.appendChild(ctl);
          clist.appendChild(row);
        });
        root.appendChild(clist);

        return root;
      });
    },
  };

  /* ================= SETTINGS & KNOWLEDGE ================= */
  HL.pages.settings = {
    title: "Settings & Knowledge",
    render: function () {
      return Promise.all([HL.api("/api/knowledge"), HL.api("/api/budget")]).then(function (res) {
        var kb = res[0], bud = res[1];
        var root = HL.el("div");
        var intro = HL.el("p", "sec-intro");
        intro.innerHTML = "Your AI team answers customers only from what's in here.";
        root.appendChild(intro);

        /* ---- spend cap ---- */
        var bp = HL.panel("AI spend cap", bud.month);
        var bb = HL.el("div", "panel-body");
        var bar = HL.el("div", "spend-bar");
        var fill = HL.el("i");
        fill.style.width = Math.min(100, bud.percent) + "%";
        if (bud.percent >= 100) fill.classList.add("full");
        else if (bud.percent >= 80) fill.classList.add("warn");
        bar.appendChild(fill);
        var line = HL.el("div", "spend-line");
        line.innerHTML = "<strong>A$" + bud.spent.toFixed(2) + "</strong> of A$" + bud.cap +
          " used this month · <span>A$" + bud.remaining.toFixed(2) + " left</span>";
        bb.appendChild(line);
        bb.appendChild(bar);
        if (bud.exhausted) {
          bb.appendChild(HL.el("div", "spend-note", "Cap reached — paid AI work is paused until you raise it or the month rolls over."));
        }
        var row = HL.el("div", "frow");
        row.style.marginTop = "14px";
        var capIn = HL.input("Monthly cap in AUD", String(bud.cap));
        capIn.type = "number"; capIn.min = "0"; capIn.step = "5";
        row.appendChild(HL.field("Monthly cap (A$)", capIn));
        var saveCap = HL.el("button", "btn", "Save cap");
        saveCap.style.alignSelf = "flex-end";
        saveCap.addEventListener("click", function () {
          HL.post("/api/budget", { monthlyCapAUD: Number(capIn.value) }, "PUT")
            .then(function () { HL.toast("Spend cap updated"); HL.navigate(); })
            .catch(function (e) { HL.toast(e.message, true); });
        });
        var wrapBtn = HL.el("div", "field");
        wrapBtn.appendChild(HL.el("label", null, " "));
        wrapBtn.appendChild(saveCap);
        row.appendChild(wrapBtn);
        bb.appendChild(row);
        bb.appendChild(HL.el("div", "spend-note",
          "The AI spends freely under this ceiling and stops dead when it's hit. Rough costs: chat ~1c a turn, image ~6c, video ~5c per second."));
        bp.appendChild(bb);
        root.appendChild(bp);

        var panel = HL.panel("Business knowledge base", kb.updatedAt ? "Updated " + HL.fmtWhen(kb.updatedAt) : "Not filled in yet");
        var body = HL.el("div", "panel-body");

        var desc = document.createElement("textarea");
        desc.className = "textarea"; desc.value = kb.description || ""; desc.placeholder = "What the business does, in a paragraph…";
        body.appendChild(HL.field("Business description", desc));

        var services = document.createElement("textarea");
        services.className = "textarea";
        services.value = (kb.services || []).map(function (s) { return s.price ? s.name + " | " + s.price : s.name; }).join("\n");
        services.placeholder = "One per line: Service name | price\ne.g. Group ride coaching | $49";
        body.appendChild(HL.field("Services & pricing", services));

        var hours = document.createElement("textarea");
        hours.className = "textarea";
        hours.value = Object.entries(kb.hours || {}).map(function (e) { return e[0] + " | " + e[1]; }).join("\n");
        hours.placeholder = "One per line: Days | times\ne.g. Mon-Fri | 9:00 AM - 5:00 PM";
        body.appendChild(HL.field("Opening hours", hours));

        var faqs = document.createElement("textarea");
        faqs.className = "textarea";
        faqs.value = (kb.faqs || []).map(function (f) { return f.q + " | " + f.a; }).join("\n");
        faqs.placeholder = "One per line: Question | Answer";
        body.appendChild(HL.field("FAQs", faqs));

        var policies = document.createElement("textarea");
        policies.className = "textarea"; policies.value = kb.policies || ""; policies.placeholder = "Cancellations, refunds, guarantees…";
        body.appendChild(HL.field("Policies", policies));

        var r = HL.el("div", "frow");
        var locations = HL.input("Suburbs / areas served", kb.locations || "");
        var voice = HL.input("e.g. friendly, Aussie-casual, no jargon", kb.brandVoice || "");
        r.appendChild(HL.field("Service locations", locations));
        r.appendChild(HL.field("Brand voice", voice));
        body.appendChild(r);

        var staff = document.createElement("textarea");
        staff.className = "textarea";
        staff.value = (kb.staff || []).map(function (s) { return s.name + " | " + s.role; }).join("\n");
        staff.placeholder = "One per line: Name | role";
        body.appendChild(HL.field("Staff", staff));

        var save = HL.el("button", "btn", "Save knowledge base");
        save.addEventListener("click", function () {
          var payload = {
            description: desc.value.trim(),
            services: services.value.split("\n").map(function (l) {
              var p = l.split("|").map(function (x) { return x.trim(); });
              return p[0] ? { name: p[0], price: p[1] || "" } : null;
            }).filter(Boolean),
            hours: Object.fromEntries(hours.value.split("\n").map(function (l) {
              var p = l.split("|").map(function (x) { return x.trim(); });
              return p[0] && p[1] ? [p[0], p[1]] : null;
            }).filter(Boolean)),
            faqs: faqs.value.split("\n").map(function (l) {
              var p = l.split("|").map(function (x) { return x.trim(); });
              return p[0] && p[1] ? { q: p[0], a: p[1] } : null;
            }).filter(Boolean),
            policies: policies.value.trim(),
            locations: locations.value.trim(),
            brandVoice: voice.value.trim(),
            staff: staff.value.split("\n").map(function (l) {
              var p = l.split("|").map(function (x) { return x.trim(); });
              return p[0] ? { name: p[0], role: p[1] || "" } : null;
            }).filter(Boolean),
          };
          HL.post("/api/knowledge", payload, "PUT").then(function () { HL.toast("Knowledge base saved — your AI team knows it now"); }).catch(function (e) { HL.toast(e.message, true); });
        });
        body.appendChild(save);
        panel.appendChild(body);
        root.appendChild(panel);
        return root;
      });
    },
  };

  /* ================= TEAM ================= */
  HL.pages.team = {
    title: "Team",
    render: function () {
      return HL.api("/api/team").then(function (team) {
        var root = HL.el("div");
        root.appendChild(HL.setupNote("<b>One login for now</b> — roles become real accounts once the app is hosted."));
        var bar = HL.el("div");
        bar.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:12px";
        var add = HL.el("button", "btn", "+ Add team member");
        add.addEventListener("click", function () {
          var body = HL.el("div");
          var name = HL.input("Full name");
          var email = HL.input("Email");
          var role = HL.select([
            { value: "owner", label: "Owner — everything" },
            { value: "manager", label: "Manager — everything except billing" },
            { value: "member", label: "Member — day-to-day tools" },
          ], "member");
          body.appendChild(HL.field("Name", name));
          body.appendChild(HL.field("Email", email));
          body.appendChild(HL.field("Role", role));
          HL.modal("Add team member", body, function () {
            return HL.post("/api/team", { name: name.value, email: email.value, role: role.value })
              .then(function () { HL.toast("Added"); HL.navigate(); });
          });
        });
        bar.appendChild(add);
        root.appendChild(bar);

        var panel = HL.panel("Roster", team.length + " member" + (team.length === 1 ? "" : "s"));
        if (!team.length) {
          panel.appendChild(HL.emptyState("", "Just you so far. Add Terry so the roles are ready when logins arrive.", "+ Add member", function () { add.click(); }));
        } else {
          var tbl = document.createElement("table");
          tbl.className = "tbl";
          tbl.innerHTML = "<thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>";
          var tb = document.createElement("tbody");
          team.forEach(function (m) {
            var tr = document.createElement("tr");
            tr.innerHTML = "<td><b>" + HL.esc(m.name) + "</b></td><td>" + HL.esc(m.email || "—") + "</td><td><span class='pill-st blue'>" + HL.esc(m.role) + "</span></td><td></td>";
            var del = HL.el("button", "btn danger sm", "Remove");
            del.addEventListener("click", function () {
              HL.api("/api/team/" + m.id, { method: "DELETE" }).then(HL.navigate);
            });
            tr.lastChild.appendChild(del);
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          panel.appendChild(tbl);
        }
        root.appendChild(panel);
        return root;
      });
    },
  };

  /* ================= SETUP-FLOW PAGES (honest states) ================= */
  function setupPage(title, emoji, blurb, needs, configFields, previewPanelFn) {
    return function () {
      var root = HL.el("div");
      root.appendChild(HL.setupNote("<b>" + title + " isn't live yet.</b> " + needs + " Everything below is the real configuration — once the connection exists, it switches on without rebuilding anything."));
      var grid = HL.el("div", "grid cols-2");

      var about = HL.panel("What you'll get", "");
      var ab = HL.el("div", "panel-body");
      var p = HL.el("p", null, blurb);
      p.style.cssText = "color:var(--muted);font-size:13.5px;line-height:1.65;margin:0 0 6px";
      ab.appendChild(p);
      about.appendChild(ab);
      grid.appendChild(about);

      if (previewPanelFn) grid.appendChild(previewPanelFn());

      if (configFields) {
        var conf = HL.panel("Configuration", "Saved to your knowledge base");
        var cb = HL.el("div", "panel-body");
        configFields(cb);
        conf.appendChild(cb);
        grid.appendChild(conf);
      }
      root.appendChild(grid);
      return Promise.resolve(root);
    };
  }

  HL.pages.inbox = {
    title: "Unified Inbox",
    render: setupPage(
      "The Unified Inbox", "",
      "Every DM, email and SMS in one stream, with Riley drafting the replies.",
      "Each channel connects in <a href='#/integrations' style='color:var(--accent);font-weight:600'>Integrations</a>.",
      null,
      function () {
        var p = HL.panel("Channels", "");
        var b = HL.el("div", "panel-body");
        [["Instagram DMs", "Meta approval"], ["Facebook Messenger", "Meta approval"], ["WhatsApp Business", "Meta approval"], ["Website live chat", "embed script — coming with hosting"], ["Email", "Gmail connection"], ["SMS", "Twilio connection"]].forEach(function (c) {
          var r = HL.el("div");
          r.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13.5px";
          r.appendChild(HL.el("span", null, c[0]));
          r.appendChild(HL.el("span", "pill-st grey", "needs " + c[1]));
          b.appendChild(r);
        });
        p.appendChild(b);
        return p;
      }
    ),
  };

  HL.pages.phone = {
    title: "AI Phone System",
    render: function () {
      return HL.api("/api/knowledge").then(function (kb) {
        var root = HL.el("div");
        root.appendChild(HL.setupNote("<b>Phone line not connected yet</b> — needs Twilio. The receptionist brain already works in chat."));
        var grid = HL.el("div", "grid cols-2");

        var what = HL.panel("What Harper will do on calls", "");
        var wb = HL.el("div", "panel-body");
        ["Answer with your greeting, 24/7", "Answer questions from the knowledge base", "Book, reschedule and cancel appointments (clash-checked)", "Take messages and alert you", "Transfer to a human on request", "Log every call with a transcript and summary"].forEach(function (c) {
          var r = HL.el("div");
          r.style.cssText = "display:flex;gap:8px;padding:5px 0;font-size:13.5px;color:var(--muted)";
          r.innerHTML = "<span style='color:var(--ok)'>✓</span>" + HL.esc(c);
          wb.appendChild(r);
        });
        what.appendChild(wb);
        grid.appendChild(what);

        var conf = HL.panel("Receptionist settings", "Takes effect the moment the line connects");
        var cb = HL.el("div", "panel-body");
        var rec = kb.receptionist || {};
        var name = HL.input("Receptionist name", rec.name || "Harper");
        var greeting = HL.input("Greeting", rec.greeting || "Thanks for calling — how can I help?");
        var transfer = HL.input("Transfer calls to (your mobile)", rec.transfer || "");
        var canBook = HL.select([{ value: "yes", label: "Yes — book directly (clash-checked)" }, { value: "confirm", label: "Pencil in, I confirm" }], rec.canBook || "yes");
        cb.appendChild(HL.field("Name", name));
        cb.appendChild(HL.field("Greeting", greeting));
        cb.appendChild(HL.field("Transfer number", transfer));
        cb.appendChild(HL.field("Booking permission", canBook));
        var save = HL.el("button", "btn", "Save settings");
        save.addEventListener("click", function () {
          HL.post("/api/knowledge", { receptionist: { name: name.value, greeting: greeting.value, transfer: transfer.value, canBook: canBook.value } }, "PUT")
            .then(function () { HL.toast("Saved — ready for when the line connects"); });
        });
        cb.appendChild(save);
        conf.appendChild(cb);
        grid.appendChild(conf);
        root.appendChild(grid);
        return root;
      });
    },
  };

  HL.pages.email = {
    title: "Email & SMS",
    render: setupPage(
      "Email & SMS sending", "",
      "Campaigns, confirmations and reminders — written by your AI team in your voice.",
      "Sending needs Gmail + Twilio — connect in <a href='#/integrations' style='color:var(--accent);font-weight:600'>Integrations</a>.",
      function (cb) {
        var tpl = document.createElement("textarea");
        tpl.className = "textarea";
        tpl.placeholder = "Draft your welcome message template here — it's saved and used the day sending goes live…";
        cb.appendChild(HL.field("Welcome template (draft)", tpl));
        var save = HL.el("button", "btn", "Save draft");
        save.addEventListener("click", function () {
          HL.post("/api/knowledge", { welcomeTemplate: tpl.value }, "PUT").then(function () { HL.toast("Draft saved"); });
        });
        cb.appendChild(save);
      }
    ),
  };

  HL.pages.billing = {
    title: "Billing",
    render: function () {
      var root = HL.el("div");
      root.appendChild(HL.setupNote("<b>Billing is off</b> — plans go live when Stripe connects. No one is charged today."));
      var grid = HL.el("div", "grid cols-3");
      [
        { name: "Professional", price: "A$249", feats: ["Social Media Manager + content calendar", "Website ingestion & knowledge base", "CRM & appointments", "2 AI employees"] },
        { name: "Business", price: "A$499", feats: ["Everything in Professional", "All 6 AI employees", "Automations & unified inbox", "Email & SMS sending"], hot: true },
        { name: "Enterprise", price: "A$999", feats: ["Everything in Business", "AI phone receptionist", "Team accounts & permissions", "Priority support"] },
      ].forEach(function (p) {
        var c = HL.el("div", "int-card");
        if (p.hot) { c.style.borderColor = "var(--accent-border)"; c.style.boxShadow = "0 14px 40px rgba(10,132,255,.12)"; }
        c.appendChild(HL.el("div", "int-name", p.name));
        var pr = HL.el("div");
        pr.style.cssText = "font-family:var(--head);font-weight:800;font-size:30px;letter-spacing:-.02em";
        pr.innerHTML = p.price + "<span style='font-size:13px;color:var(--dim);font-weight:500'>/month</span>";
        c.appendChild(pr);
        p.feats.forEach(function (f) {
          var r = HL.el("div");
          r.style.cssText = "font-size:13px;color:var(--muted);padding:3px 0";
          r.innerHTML = "<span style='color:var(--ok)'>✓</span> " + HL.esc(f);
          c.appendChild(r);
        });
        var b = HL.el("button", "btn ghost sm", "Available when Stripe connects");
        b.disabled = true;
        c.appendChild(b);
        grid.appendChild(c);
      });
      root.appendChild(grid);
      return Promise.resolve(root);
    },
  };

  /* Real brand marks for the Integrations page — inline SVG, brand colours. */
  HL.BRAND_ICONS = {
    anthropic: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#D97757\"/><path fill=\"#fff\" d=\"M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z\"/></svg>",
    instagram: "<svg viewBox=\"-5 -5 34 34\"><defs><radialGradient id=\"igbg\" cx=\"30%\" cy=\"107%\" r=\"150%\"><stop offset=\"0%\" stop-color=\"#FDF497\"/><stop offset=\"45%\" stop-color=\"#FD5949\"/><stop offset=\"60%\" stop-color=\"#D6249F\"/><stop offset=\"90%\" stop-color=\"#285AEB\"/></radialGradient></defs><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"url(#igbg)\"/><path fill=\"#fff\" d=\"M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077\"/></svg>",
    facebook: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#0866FF\"/><path fill=\"#fff\" d=\"M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z\"/></svg>",
    tiktok: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#000000\"/><path fill=\"#fff\" d=\"M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z\"/></svg>",
    linkedin: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#0A66C2\"/><path fill=\"#fff\" d=\"M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z\"/></svg>",
    youtube: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#FF0000\"/><path fill=\"#fff\" d=\"M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z\"/></svg>",
    gcal: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#fff\"/><path fill=\"#4285F4\" d=\"M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z\"/></svg>",
    gmail: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#fff\"/><path fill=\"#EA4335\" d=\"M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z\"/></svg>",
    stripe: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#635BFF\"/><path fill=\"#fff\" d=\"M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z\"/></svg>",
    twilio: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#F22F46\"/><path fill=\"#fff\" d=\"M12 0C5.381-.008.008 5.352 0 11.971V12c0 6.64 5.359 12 12 12 6.64 0 12-5.36 12-12 0-6.641-5.36-12-12-12zm0 20.801c-4.846.015-8.786-3.904-8.801-8.75V12c-.014-4.846 3.904-8.786 8.75-8.801H12c4.847-.014 8.786 3.904 8.801 8.75V12c.015 4.847-3.904 8.786-8.75 8.801H12zm5.44-11.76c0 1.359-1.12 2.479-2.481 2.479-1.366-.007-2.472-1.113-2.479-2.479 0-1.361 1.12-2.481 2.479-2.481 1.361 0 2.481 1.12 2.481 2.481zm0 5.919c0 1.36-1.12 2.48-2.481 2.48-1.367-.008-2.473-1.114-2.479-2.48 0-1.359 1.12-2.479 2.479-2.479 1.361-.001 2.481 1.12 2.481 2.479zm-5.919 0c0 1.36-1.12 2.48-2.479 2.48-1.368-.007-2.475-1.113-2.481-2.48 0-1.359 1.12-2.479 2.481-2.479 1.358-.001 2.479 1.12 2.479 2.479zm0-5.919c0 1.359-1.12 2.479-2.479 2.479-1.367-.007-2.475-1.112-2.481-2.479 0-1.361 1.12-2.481 2.481-2.481 1.358 0 2.479 1.12 2.479 2.481z\"/></svg>",
    whatsapp: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#25D366\"/><path fill=\"#fff\" d=\"M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z\"/></svg>",
    shopify: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#5E8E3E\"/><path fill=\"#fff\" d=\"M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z\"/></svg>",
    wordpress: "<svg viewBox=\"-5 -5 34 34\"><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"#21759B\"/><path fill=\"#fff\" d=\"M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0\"/></svg>",
    videoai: "<svg viewBox=\"-5 -5 34 34\"><defs><linearGradient id=\"vag\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#0A84FF\"/><stop offset=\"100%\" stop-color=\"#FF2D92\"/></linearGradient></defs><rect x=\"-5\" y=\"-5\" width=\"34\" height=\"34\" rx=\"8.5\" fill=\"url(#vag)\"/><path fill=\"#fff\" d=\"M8 7.5l9 4.5-9 4.5v-9z\"/></svg>",
  };

  /* ===================== Customer Accounts (admin only) ===================== */
  HL.pages.accounts = {
    title: "Customer Accounts",
    render: function () {
      if (!HL.user || HL.user.role !== "admin") {
        return Promise.resolve(HL.emptyState("🔒", "This page is for the HarperLinks team."));
      }
      return HL.api("/api/accounts").then(function (users) {
        var root = HL.el("div");
        root.appendChild(HL.el("p", "sec-intro", "Every paying customer gets their own account here — their data, posts and connections are completely separate from everyone else's."));

        var addWrap = HL.el("div");
        addWrap.style.cssText = "max-width:720px;margin:0 auto 14px;display:flex;justify-content:flex-end";
        var addBtn = HL.el("button", "btn", "+ New customer account");
        addBtn.addEventListener("click", function () {
          var body = HL.el("div");
          var biz = HL.input("Business name — e.g. Bella's Cafe");
          var nm = HL.input("Owner's name");
          var em = HL.input("Their email (this is their sign-in)");
          var pw = HL.input("Temporary password (they can change it later)");
          body.appendChild(HL.field("Business", biz));
          body.appendChild(HL.field("Owner", nm));
          body.appendChild(HL.field("Email", em));
          body.appendChild(HL.field("Temporary password — at least 8 characters", pw));
          HL.modal("New customer account", body, function () {
            return HL.post("/api/accounts", { business: biz.value, name: nm.value, email: em.value, password: pw.value })
              .then(function () { HL.toast("Account created — they can sign in now"); HL.navigate(); });
          }, "Create account");
        });
        addWrap.appendChild(addBtn);
        root.appendChild(addWrap);

        var list = HL.el("div", "rowlist");
        list.style.cssText = "max-width:720px;margin:0 auto";
        var customers = users.filter(function (u) { return u.role !== "admin"; });
        if (!customers.length) {
          root.appendChild(HL.emptyState("🏁", "No customers yet. When someone pays, create their account here and set them up within 7 days."));
          return root;
        }
        var PLAN_LABEL = { professional: "Professional · A$249", business: "Business · A$499", enterprise: "Enterprise · A$999" };

        customers.forEach(function (u) {
          var row = HL.el("div", "lrow acct-row");
          row.appendChild(HL.el("div", "mono" + (u.disabled ? "" : " on"), (u.name || "?").charAt(0).toUpperCase()));
          var main = HL.el("div", "lmain");

          var nameLine = HL.el("div", "lname", u.name + (u.disabled ? " — disabled" : ""));
          // subscription pill: click it to change plan or status
          var planPill = HL.el("button", "plan-pill " + (u.planStatus || "trial"));
          planPill.type = "button";
          planPill.textContent = (PLAN_LABEL[u.plan] || "Professional · A$249") + " · " + (u.planStatus || "trial");
          planPill.title = "Change plan or subscription status";
          planPill.addEventListener("click", function () {
            var body = HL.el("div");
            function sel(options, value) {
              var s = document.createElement("select");
              s.className = "hl-select";
              options.forEach(function (o) {
                var op = document.createElement("option");
                op.value = o; op.textContent = o.charAt(0).toUpperCase() + o.slice(1);
                if (o === value) op.selected = true;
                s.appendChild(op);
              });
              return s;
            }
            var plan = sel(["professional", "business", "enterprise"], u.plan || "professional");
            var status = sel(["trial", "active", "paused", "cancelled"], u.planStatus || "trial");
            body.appendChild(HL.field("Plan", plan));
            body.appendChild(HL.field("Subscription status", status));
            var hint = HL.el("p", null, "Status is your record of where their payment stands. To actually lock them out, use Disable.");
            hint.style.cssText = "color:var(--muted);font-size:12.5px;line-height:1.5;margin:4px 0 0";
            body.appendChild(hint);
            HL.modal("Subscription — " + u.name, body, function () {
              return HL.post("/api/accounts/" + u.id, { plan: plan.value, planStatus: status.value }, "PATCH")
                .then(function () { HL.toast("Subscription updated"); HL.navigate(); });
            }, "Save");
          });
          nameLine.appendChild(planPill);
          main.appendChild(nameLine);

          var sub = HL.el("div", "lsub", u.email + " · account: " + u.accountId + " · ");
          var ghlChip = HL.el("span", "ghl-chip " + (u.ghlConnected ? "on" : u.ghlConfigured ? "warn" : "off"),
            u.ghlConnected ? "publishing connected" : u.ghlConfigured ? "publishing saved — not working" : "publishing not connected");
          sub.appendChild(ghlChip);
          main.appendChild(sub);
          row.appendChild(main);

          var ctl = HL.el("div", "lctl");
          ctl.style.cssText = "display:flex;gap:7px;flex-wrap:wrap";

          // step straight into their dashboard
          var asBtn = HL.el("button", "btn sm", "Log in as");
          asBtn.addEventListener("click", function () {
            asBtn.disabled = true;
            HL.post("/api/accounts/" + u.id + "/impersonate")
              .then(function () { location.href = "/"; })
              .catch(function (e) { asBtn.disabled = false; HL.toast(e.message || "Couldn't sign in", true); });
          });
          ctl.appendChild(asBtn);

          if (u.ghlConfigured) {
            var socBtn = HL.el("button", "btn ghost sm", "Socials ↗");
            socBtn.title = "Open this account's publishing engine to link Instagram/Facebook/TikTok/LinkedIn/YouTube";
            socBtn.addEventListener("click", function () {
              HL.api("/api/accounts/" + u.accountId + "/connect-info").then(function (ci) {
                if (ci.configured) window.open(ci.url, "_blank", "noopener");
                else HL.toast("No engine on this account yet — Connect first", true);
              });
            });
            ctl.appendChild(socBtn);
          }

          var ghlBtn = HL.el("button", "btn ghost sm", u.ghlConfigured ? "Reconnect" : "Connect");
          ghlBtn.addEventListener("click", function () {
            var body = HL.el("div");
            var note = HL.el("p", null, "Paste their GHL Private Integration token, then the location — the full URL from the browser bar works, the id is pulled out automatically. Saved into their account only, tested immediately, never shown again.");
            note.style.cssText = "color:var(--muted);font-size:13px;line-height:1.55";
            var tok = HL.input("pit-…");
            var loc = HL.input("Location id — or just paste the GHL URL");
            // paste the whole GHL address bar → location id extracted for you
            loc.addEventListener("input", function () {
              var m = loc.value.match(/location\/([A-Za-z0-9]{10,})/);
              if (m) { loc.value = m[1]; HL.toast("Location id pulled out of the URL"); }
            });
            body.appendChild(note);
            body.appendChild(HL.field("Private Integration token", tok));
            body.appendChild(HL.field("Location", loc));
            HL.modal("Connect publishing — " + u.accountId, body, function () {
              return HL.post("/api/accounts/" + u.accountId + "/ghl", { token: tok.value, locationId: loc.value })
                .then(function (out) {
                  HL.toast(out.connected ? "Connected · " + (out.detail || "working") : "Saved, but not working: " + out.detail, !out.connected);
                  HL.navigate();
                });
            }, "Save & test");
          });
          ctl.appendChild(ghlBtn);

          var pwBtn = HL.el("button", "btn ghost sm", "Reset password");
          pwBtn.addEventListener("click", function () {
            var body = HL.el("div");
            var pw = HL.input("New password — at least 8 characters");
            body.appendChild(HL.field("New password for " + u.email, pw));
            HL.modal("Reset password", body, function () {
              return HL.post("/api/accounts/" + u.id, { password: pw.value }, "PATCH")
                .then(function () { HL.toast("Password updated"); });
            }, "Update");
          });
          ctl.appendChild(pwBtn);

          var disBtn = HL.el("button", "btn ghost sm", u.disabled ? "Re-enable" : "Disable");
          disBtn.addEventListener("click", function () {
            HL.post("/api/accounts/" + u.id, { disabled: !u.disabled }, "PATCH")
              .then(function () { HL.toast(u.disabled ? "Account re-enabled" : "Account disabled — they can't sign in"); HL.navigate(); });
          });
          ctl.appendChild(disBtn);

          row.appendChild(ctl);
          list.appendChild(row);
        });
        root.appendChild(list);
        return root;
      });
    },
  };
})();
