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

        var title = HL.el("h2", "cc-title",
          empDef ? "Talk to " + empDef.name + "."
          : profile.configured ? "What should we get done, " + profile.name.split(" ")[0] + "?"
          : "Where should we start?");
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
        emps.forEach(function (e) {
          var b = HL.el("button", "cc-team-m" + (e.enabled ? " on" : "") + (emp === e.id ? " sel" : ""));
          b.title = e.name + " — " + e.role + (e.enabled ? "" : " (off)");
          b.textContent = e.name.charAt(0);
          b.addEventListener("click", function () { location.hash = "#/overview?emp=" + e.id; });
          strip.appendChild(b);
        });
        var stripWrap = HL.el("div", "cc-teamwrap");
        stripWrap.appendChild(HL.el("div", "cc-teamlabel", "Your AI team"));
        stripWrap.appendChild(strip);
        root.appendChild(stripWrap);

        root.appendChild(bench);

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
        root.appendChild(HL.el("p", "sec-intro", "Switch them on. Pick how much freedom they get."));

        var list = HL.el("div", "rowlist");
        list.style.maxWidth = "760px";
        list.style.margin = "0 auto";
        emps.forEach(function (e) {
          var row = HL.el("div", "lrow");
          var mono = HL.el("div", "mono" + (e.enabled ? " on" : ""), e.name.charAt(0));
          row.appendChild(mono);
          var main = HL.el("div", "lmain");
          var nm = HL.el("div", "lname", e.name);
          nm.appendChild(HL.el("span", null, e.role));
          main.appendChild(nm);
          var sub = HL.el("div", "lsub" + (e.needs && e.needs.length && !e.ready ? " needs" : ""),
            e.needs && e.needs.length && !e.ready ? "Needs " + e.needs[0] : e.description);
          main.appendChild(sub);
          row.appendChild(main);
          var ctl = HL.el("div", "lctl");
          var chatB = HL.el("button", "btn ghost sm", "Chat");
          chatB.addEventListener("click", function () { location.hash = "#/overview?emp=" + e.id; });
          ctl.appendChild(chatB);
          var WORKSPACES = { social: "social", support: "inbox", receptionist: "phone", sales: "crm", web: "website", manager: "analytics" };
          var wsB = HL.el("button", "btn ghost sm", "Workspace");
          wsB.addEventListener("click", function () { location.hash = "#/" + (WORKSPACES[e.id] || "overview"); });
          ctl.appendChild(wsB);
          var modeSel = HL.select([
            { value: "assisted", label: "Assisted" },
            { value: "supervised", label: "Supervised" },
            { value: "autonomous", label: "Autonomous" },
          ], e.mode);
          modeSel.addEventListener("change", function () {
            HL.post("/api/employees/" + e.id, { mode: modeSel.value }, "PATCH")
              .then(function () { HL.toast(e.name + " set to " + modeSel.value); })
              .catch(function (err) { HL.toast(err.message, true); });
          });
          ctl.appendChild(modeSel);
          ctl.appendChild(HL.switchEl(e.enabled, function (on) {
            HL.post("/api/employees/" + e.id, { enabled: on }, "PATCH")
              .then(function () {
                mono.classList.toggle("on", on);
                HL.toast(e.name + (on ? " activated" : " paused"));
              })
              .catch(function (err) { HL.toast(err.message, true); });
          }));
          row.appendChild(ctl);
          list.appendChild(row);
        });
        root.appendChild(list);
        return root;
      });
    },
  };

  /* ================= AUTOMATIONS ================= */
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
      return HL.api("/api/profile").then(function (profile) {
        var root = HL.el("div");
        var grid = HL.el("div", "grid cols-2");

        var info = HL.panel("Your website", profile.configured ? "Learned " + HL.fmtDay(profile.ingestedAt) : "Not ingested yet");
        var body = HL.el("div", "panel-body");
        if (profile.configured) {
          [["Business", profile.name + " · " + profile.businessType], ["Source", profile.sourceUrl], ["Tagline", profile.tagline || "—"], ["Audience", profile.audience || "—"], ["Voice", profile.tone || "—"]].forEach(function (f) {
            var r = HL.el("div", "pf-row");
            r.appendChild(HL.el("span", "pf-label", f[0]));
            r.appendChild(HL.el("span", "pf-val", f[1]));
            body.appendChild(r);
          });
          if ((profile.services || []).length) {
            var r2 = HL.el("div", "pf-row");
            r2.appendChild(HL.el("span", "pf-label", "Services detected"));
            var tags = HL.el("div", "pf-tags");
            profile.services.forEach(function (s) { tags.appendChild(HL.el("span", "pf-tag", s)); });
            r2.appendChild(tags);
            body.appendChild(r2);
          }
        } else {
          body.appendChild(HL.el("p", "sec-intro", "Paste your website — your AI team learns it and works in your voice."));
        }
        var row = HL.el("div", "ingest-row");
        var url = HL.input(profile.configured ? "Re-ingest (e.g. after site changes)" : "https://yourbusiness.com");
        var go = HL.el("button", "ingest-btn", "Ingest");
        go.addEventListener("click", function () {
          if (!url.value.trim()) return HL.toast("Paste a website address first.", true);
          go.disabled = true; go.textContent = "Learning…";
          HL.post("/api/ingest", { url: url.value.trim() })
            .then(function (out) { HL.toast("Learned " + out.profile.name + " ✓"); HL.navigate(); })
            .catch(function (e) { HL.toast(e.message, true); go.disabled = false; go.textContent = "Ingest"; });
        });
        row.appendChild(url); row.appendChild(go);
        body.appendChild(row);
        info.appendChild(body);
        grid.appendChild(info);

        var right = HL.el("div");
        right.style.cssText = "display:flex;flex-direction:column;gap:16px";
        if (profile.configured) {
          var prev = HL.panel("Preview", "");
          var pb = HL.el("div", "panel-body");
          var frame = document.createElement("iframe");
          frame.src = profile.sourceUrl;
          frame.style.cssText = "width:100%;height:260px;border:1px solid var(--border);border-radius:12px;background:#fff";
          frame.loading = "lazy";
          pb.appendChild(frame);
          pb.appendChild(HL.el("p", "sec-intro", "Live view of your current site. Some sites block embedding — open it directly if the preview is blank."));
          prev.appendChild(pb);
          right.appendChild(prev);
        }
        var edits = HL.panel("AI website editing", "");
        var eb = HL.el("div", "panel-body");
        eb.appendChild(HL.setupNote("<b>Live edits need CMS access</b> (WordPress). Until then, ask the chat to draft page copy and paste it in."));
        edits.appendChild(eb);
        right.appendChild(edits);
        grid.appendChild(right);
        root.appendChild(grid);
        return root;
      });
    },
  };

  /* ================= ANALYTICS ================= */
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
          var row = HL.el("div", "grid cols-4");
          row.appendChild(HL.stat("Leads", t.leads, t.conversion === null ? "no conversions yet" : t.conversion + "% convert to won"));
          row.appendChild(HL.stat("Appointments", t.appointments, t.upcoming + " upcoming"));
          row.appendChild(HL.stat("Posts published", t.postsPublished, "pipeline (preview mode)"));
          row.appendChild(HL.stat("Automation runs", stats.series.reduce(function (n, d) { return n + d.automations; }, 0), "in this period"));
          row.style.marginBottom = "16px";
          root.appendChild(row);

          var c1 = HL.panel("Growth", "Leads & appointments per day");
          c1.appendChild(HL.lineChart(stats.series, ["leads", "appointments"], COLORS));
          c1.appendChild(HL.legend(["Leads", "Appointments"], COLORS));
          root.appendChild(c1);

          var c2 = HL.panel("Content", "Posts published & scheduled per day");
          c2.style.marginTop = "16px";
          c2.appendChild(HL.lineChart(stats.series, ["published", "scheduled"], [COLORS[1], COLORS[2]]));
          c2.appendChild(HL.legend(["Published", "Scheduled"], [COLORS[1], COLORS[2]]));
          root.appendChild(c2);

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
      return HL.api("/api/integrations").then(function (ints) {
        var root = HL.el("div");
        root.appendChild(HL.el("p", "sec-intro", "Nothing shows connected unless it really is."));
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
          if (it.connected) {
            ctl.appendChild(HL.el("span", "pill-st connected", "connected"));
          } else {
            var b = HL.el("button", "btn ghost sm", "Connect");
            b.addEventListener("click", function () {
              var body = HL.el("div");
              var p = HL.el("p", null, it.how);
              p.style.cssText = "color:var(--muted);font-size:13.5px;line-height:1.6";
              body.appendChild(p);
              var p2 = HL.el("p", null, "Bring the credentials here and we wire it in — the pipeline is already built for it.");
              p2.style.cssText = "color:var(--muted);font-size:13.5px;line-height:1.6";
              body.appendChild(p2);
              HL.modal("Connect " + it.name, body);
            });
            ctl.appendChild(b);
          }
          row.appendChild(ctl);
          list.appendChild(row);
        });
        root.appendChild(list);
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
    anthropic: '<svg viewBox="0 0 24 24"><path fill="#D97757" d="M13.8 4h-3.1L5 20h3.2l1.1-3h5.2l1.1 3H19L13.8 4zm-3.5 10.4 1.6-4.6 1.6 4.6h-3.2z"/><path fill="#D97757" d="M16.4 4h3.1l-3.3 9.1-1.6-4.4L16.4 4z" opacity=".55"/></svg>',
    instagram: '<svg viewBox="0 0 24 24"><defs><radialGradient id="igg" cx="30%" cy="107%" r="150%"><stop offset="0%" stop-color="#FDF497"/><stop offset="45%" stop-color="#FD5949"/><stop offset="60%" stop-color="#D6249F"/><stop offset="90%" stop-color="#285AEB"/></radialGradient></defs><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="url(#igg)"/><circle cx="12" cy="12" r="4.4" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="17.2" cy="6.9" r="1.25" fill="#fff"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1877F2"/><path fill="#fff" d="M15.6 12.6h-2.3V20h-3v-7.4H8.5V10h1.8V8.4c0-2 1.2-3.4 3.4-3.4h2v2.6h-1.4c-.7 0-1 .3-1 1V10h2.6l-.3 2.6z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#000"/><path fill="#25F4EE" d="M12.6 6h2v7.4a3.6 3.6 0 1 1-3.6-3.6v2.1a1.6 1.6 0 1 0 1.6 1.6V6z"/><path fill="#FE2C55" d="M13.3 6.7h2v.1c.3 1.5 1.4 2.6 2.9 2.8v2a5 5 0 0 1-2.9-1v3.5a3.6 3.6 0 1 1-3.6-3.7v2.1h-.1a1.6 1.6 0 1 0 1.7 1.6V6.7z" opacity=".9"/><path fill="#fff" d="M13 6.3h2c.3 1.6 1.4 2.7 3 2.9v2a5.2 5.2 0 0 1-3-1v3.6a3.6 3.6 0 1 1-3.7-3.6v2a1.6 1.6 0 1 0 1.7 1.6V6.3z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fill="#0A66C2"/><path fill="#fff" d="M8.3 10v7H6V10h2.3zM7.1 6.6a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7zM10 10h2.2v1c.4-.7 1.2-1.2 2.3-1.2 1.9 0 3 1.1 3 3.4V17h-2.3v-3.4c0-1.1-.5-1.7-1.4-1.7-.9 0-1.5.6-1.5 1.7V17H10v-7z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" fill="#FF0000"/><path fill="#fff" d="M10 9l5.2 3L10 15V9z"/></svg>',
    gcal: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff"/><rect x="3" y="4" width="18" height="5" rx="3" fill="#1A73E8"/><rect x="3" y="7" width="18" height="2" fill="#1A73E8"/><text x="12" y="17.5" text-anchor="middle" font-size="8" font-weight="700" fill="#1A73E8" font-family="Arial">18</text><rect x="3" y="4" width="18" height="17" rx="3" fill="none" stroke="#1A73E8" stroke-width="1.2"/></svg>',
    gmail: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="#fff" stroke="#E8EAED" stroke-width=".8"/><path d="M4 7l8 6 8-6" fill="none" stroke="#EA4335" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 7v10" stroke="#4285F4" stroke-width="2.4" stroke-linecap="round"/><path d="M20 7v10" stroke="#34A853" stroke-width="2.4" stroke-linecap="round"/></svg>',
    stripe: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#635BFF"/><path fill="#fff" d="M11 9.7c0-.6.5-.9 1.3-.9 1 0 2.4.3 3.4.9V7c-1.1-.5-2.2-.7-3.4-.7-2.8 0-4.6 1.4-4.6 3.8 0 3.7 5 3.1 5 4.7 0 .7-.6 1-1.4 1-1.1 0-2.6-.5-3.7-1.1v2.8c1.2.5 2.5.8 3.7.8 2.8 0 4.8-1.4 4.8-3.8-.1-4-5.1-3.3-5.1-4.8z"/></svg>',
    twilio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#F22F46"/><circle cx="9.4" cy="9.4" r="1.8" fill="#fff"/><circle cx="14.6" cy="9.4" r="1.8" fill="#fff"/><circle cx="9.4" cy="14.6" r="1.8" fill="#fff"/><circle cx="14.6" cy="14.6" r="1.8" fill="#fff"/></svg>',
    videoai: '<svg viewBox="0 0 24 24"><defs><linearGradient id="vag" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0A84FF"/><stop offset="100%" stop-color="#FF2D92"/></linearGradient></defs><rect x="2.5" y="5" width="14" height="14" rx="3" fill="url(#vag)"/><path fill="#fff" d="M8 9.5l4.5 2.5L8 14.5v-5z"/><path d="M17 10l4.5-2.5v9L17 14" fill="url(#vag)"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#25D366"/><path fill="#fff" d="M12 5.8a6.1 6.1 0 0 0-5.2 9.3L6 18l3-0.8A6.1 6.1 0 1 0 12 5.8zm3.5 8.6c-.2.5-1 .9-1.4 1-.4 0-.8.2-2.6-.6-2.2-1-3.6-3.2-3.7-3.3-.1-.2-.9-1.2-.9-2.3 0-1.1.6-1.6.8-1.9.2-.2.5-.3.6-.3h.5c.1 0 .3 0 .5.4l.7 1.7c0 .1.1.3 0 .4l-.3.5-.4.4c-.1.1-.3.3-.1.5.1.3.6 1 1.3 1.6.9.8 1.6 1 1.9 1.2.2.1.4.1.5-.1l.8-.9c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3v.7z"/></svg>',
    shopify: '<svg viewBox="0 0 24 24"><path fill="#95BF47" d="M17.8 6.6s0-.2-.2-.2l-1.6-.1-1.2-1.2c-.1-.1-.3-.1-.4-.1l-.6.2C13.4 4.1 12.7 3.4 11.6 3.4c-1.9 0-3 2.4-3.4 3.7l-1.5.5c-.4.1-.5.1-.5.6L4.6 19.1l10.5 1.9 4.4-1.1L17.8 6.6zm-4.6-1l-1 .3c0-.6-.1-1.3-.4-1.8.7.2 1.1.9 1.4 1.5zm-1.9.6l-2 .6c.3-1 1-2.1 1.7-2.4.3.5.3 1.2.3 1.8z"/><path fill="#5E8E3E" d="M17.6 6.4l-1.6-.1s-1.1 10.8-1.2 12l4.4-1.1-1.4-10.6c0-.1-.1-.2-.2-.2z"/><path fill="#fff" d="M12.4 9.5l-.5 1.6s-.5-.3-1.2-.2c-1 0-1 .6-1 .8 0 .8 2.2 1.1 2.2 3.1 0 1.6-1 2.6-2.3 2.6-1.6 0-2.4-1-2.4-1l.4-1.4s.8.7 1.5.7c.4 0 .6-.4.6-.6 0-1.1-1.8-1.1-1.8-2.9 0-1.5 1.1-3 3.3-3 .8 0 1.2.3 1.2.3z"/></svg>',
    wordpress: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#21759B"/><path fill="#fff" d="M4.5 12c0-1 .2-2 .6-2.9l3.4 9.2A7.5 7.5 0 0 1 4.5 12zm12.4-.4c0 .8-.3 1.8-.7 3l-1 3.2-3.4-10c.6 0 1.1-.1 1.1-.1.5-.1.5-.8-.1-.8 0 0-1.6.1-2.6.1-.9 0-2.5-.1-2.5-.1-.5 0-.6.7 0 .8 0 0 .5 0 1 .1l1.5 4-2 6.1L4.7 7.8c.6 0 1.1-.1 1.1-.1.5-.1.5-.8-.1-.8 0 0-1.5.1-2.5.1h-.6A7.5 7.5 0 0 1 12 4.5c1.9 0 3.7.7 5 1.9h-.1c-.7 0-1.2.6-1.2 1.3 0 .6.3 1.1.7 1.7.3.5.6 1.1.6 2.2zm-4.8 1.2l2.3 6.4v.1a7.6 7.6 0 0 1-4.6.1l2.3-6.6zm6.5-4.4a7.5 7.5 0 0 1-2.8 10.1l2.3-6.6c.4-1.1.6-1.9.6-2.7v-.8z"/></svg>',
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
        customers.forEach(function (u) {
          var row = HL.el("div", "lrow");
          row.appendChild(HL.el("div", "mono" + (u.disabled ? "" : " on"), (u.name || "?").charAt(0).toUpperCase()));
          var main = HL.el("div", "lmain");
          main.appendChild(HL.el("div", "lname", u.name + (u.disabled ? " — disabled" : "")));
          main.appendChild(HL.el("div", "lsub", u.email + " · account: " + u.accountId));
          row.appendChild(main);
          var ctl = HL.el("div", "lctl");
          ctl.style.cssText = "display:flex;gap:7px;flex-wrap:wrap";

          var ghlBtn = HL.el("button", "btn ghost sm", "GoHighLevel");
          ghlBtn.addEventListener("click", function () {
            var body = HL.el("div");
            var note = HL.el("p", null, "Paste this customer's GHL Private Integration token and location id. Saved into their account only, checked against GHL immediately, never shown again.");
            note.style.cssText = "color:var(--muted);font-size:13px;line-height:1.55";
            var tok = HL.input("pit-…");
            var loc = HL.input("Location id");
            body.appendChild(note);
            body.appendChild(HL.field("Private Integration token", tok));
            body.appendChild(HL.field("Location id", loc));
            HL.modal("Connect GoHighLevel — " + u.accountId, body, function () {
              return HL.post("/api/accounts/" + u.accountId + "/ghl", { token: tok.value, locationId: loc.value })
                .then(function (out) {
                  HL.toast(out.connected ? "Connected · " + (out.detail || "working") : "Saved, but not working: " + out.detail, !out.connected);
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
