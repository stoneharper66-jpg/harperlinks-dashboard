/* HarperLinks Business OS — core runtime: router, sidebar, shared widgets. */
(function () {
  "use strict";

  var HL = (window.HL = { pages: {} });

  /* ---------- helpers ---------- */
  HL.$ = function (id) { return document.getElementById(id); };
  HL.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  HL.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  HL.sessionId = "web-" + Math.random().toString(36).slice(2, 10);

  HL.api = function (path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (d) {
        // session expired or signed out elsewhere → back to the door
        if (r.status === 401 && d.authRequired) { location.href = "/login.html"; throw new Error("Please sign in."); }
        if (!r.ok) {
          var msg = d.error || "Something went wrong";
          // User-friendly error messages for common issues
          if (msg.includes("API key")) msg = "Invalid API key. Check it and try again.";
          if (msg.includes("network")) msg = "Network error. Check your connection and try again.";
          if (msg.includes("timeout")) msg = "That took too long. Please try again.";
          throw new Error(msg);
        }
        return d;
      }).catch(function (e) {
        if (e instanceof SyntaxError) throw new Error("Server returned invalid data");
        throw e;
      });
    }).catch(function (e) {
      if (e.message.includes("Failed to fetch")) {
        throw new Error("Network error — check your connection and try again");
      }
      throw e;
    });
  };
  HL.post = function (path, body, method) {
    return HL.api(path, { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  };

  // POST that reads server-sent events back as they arrive. onEvent fires per
  // event; the promise settles when the stream closes. Rejects if the browser
  // can't stream, so callers can fall back to a plain POST.
  HL.stream = function (path, body, onEvent) {
    if (!window.ReadableStream || !window.TextDecoder) {
      return Promise.reject(new Error("no streaming"));
    }
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      if (!r.ok || !r.body) throw new Error("Request failed");
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) return;
          buf += decoder.decode(res.value, { stream: true });
          var parts = buf.split("\n\n"); // events are separated by a blank line
          buf = parts.pop();
          parts.forEach(function (chunk) {
            var line = chunk.split("\n").filter(function (l) { return l.indexOf("data:") === 0; })[0];
            if (!line) return;
            try { onEvent(JSON.parse(line.slice(5).trim())); } catch (e) { /* partial frame */ }
          });
          return pump();
        });
      }
      return pump();
    });
  };

  /* ================= global work tracker =================
     Any AI run registers here. The sidebar shows a pulsing dot on the page
     the work belongs to, a floating status pill narrates what's happening,
     and a popup lands when it finishes — so switching pages never loses
     sight of running work, and nothing resets. */
  var JOBS = {};
  var jobSeq = 0;

  function pillEl() {
    var p = HL.$("workPill");
    if (!p) {
      p = HL.el("div", "work-pill");
      p.id = "workPill";
      p.innerHTML = '<span class="wp-spin"></span><span class="wp-text"></span><span class="wp-page"></span>';
      p.hidden = true;
      document.body.appendChild(p);
    }
    return p;
  }
  function navDot(page, on) {
    var link = document.querySelector('.side-link[data-page="' + page + '"]');
    if (!link) return;
    var dot = link.querySelector(".workdot");
    var busyHere = Object.keys(JOBS).some(function (k) { return JOBS[k].page === page; });
    if (on || busyHere) {
      if (!dot) {
        dot = HL.el("span", "workdot");
        link.appendChild(dot);
      }
    } else if (dot) {
      dot.remove();
    }
  }
  function refreshPill() {
    var ids = Object.keys(JOBS);
    var p = pillEl();
    if (!ids.length) { p.hidden = true; return; }
    var j = JOBS[ids[ids.length - 1]];
    p.hidden = false;
    p.classList.remove("done");
    p.querySelector(".wp-text").textContent = j.step || j.label;
    var pageChip = p.querySelector(".wp-page");
    var navItem = HL.NAV.filter(function (n) { return n.id === j.page; })[0];
    pageChip.textContent = navItem ? navItem.label : "";
    pageChip.onclick = function () { location.hash = "#/" + j.page; };
    if (ids.length > 1) p.querySelector(".wp-text").textContent += "  (+" + (ids.length - 1) + " more)";
  }

  /* Which AI is genuinely mid-task right now.
     Driven only by real tool-start / turn-finished events from the server,
     so a face that's moving is a face doing something. Reference-counted:
     two jobs for the same employee won't have the first one to finish stop
     the animation while the second is still running. */
  var EMP_BUSY = {};
  HL.employeeBusy = function (id, on) {
    if (!id) return;
    EMP_BUSY[id] = Math.max(0, (EMP_BUSY[id] || 0) + (on ? 1 : -1));
    var busy = EMP_BUSY[id] > 0;
    document.querySelectorAll('[data-emp="' + id + '"]').forEach(function (el) {
      el.classList.toggle("at-work", busy);
    });
  };
  // Re-apply after a re-render, or a face repainted mid-task would go still
  // while its AI is still working.
  HL.repaintBusy = function () {
    Object.keys(EMP_BUSY).forEach(function (id) {
      if (!EMP_BUSY[id]) return;
      document.querySelectorAll('[data-emp="' + id + '"]').forEach(function (el) {
        el.classList.add("at-work");
      });
    });
  };

  HL.jobStart = function (page, label) {
    var id = "job" + (++jobSeq);
    JOBS[id] = { page: page, label: label, step: "Working on it…" };
    navDot(page, true);
    refreshPill();
    return id;
  };
  HL.jobStep = function (id, step) {
    if (!JOBS[id]) return;
    JOBS[id].step = step;
    refreshPill();
  };
  HL.jobDone = function (id, summary, ok) {
    var j = JOBS[id];
    if (!j) return;
    delete JOBS[id];
    navDot(j.page, false);
    refreshPill();
    // the landing popup — brief, celebratory, honest
    var pop = HL.el("div", "work-done" + (ok === false ? " bad" : ""));
    pop.innerHTML = (ok === false ? "!" : "✓") + " <span>" + HL.esc(summary || j.label) + "</span>";
    document.body.appendChild(pop);
    setTimeout(function () { pop.classList.add("out"); }, 3400);
    setTimeout(function () { pop.remove(); }, 3900);
  };

  /* visible AI usage — HQ bookkeeping, so admins only. Customers pay a flat
     plan; showing them an internal cost meter just reads as a worry. */
  HL.refreshBudget = function () {
    var box = HL.$("usageBox");
    if (!box) return;
    if (!HL.user || HL.user.role !== "admin") { box.hidden = true; return; }
    HL.api("/api/budget").then(function (b) {
      var pct = Math.min(100, Math.round((b.spent / Math.max(0.01, b.cap)) * 100));
      box.hidden = false;
      box.querySelector(".ub-label").textContent = "AI usage · A$" + b.spent.toFixed(2) + " of A$" + b.cap;
      var bar = box.querySelector(".ub-fill");
      bar.style.width = Math.max(2, pct) + "%";
      bar.className = "ub-fill" + (pct >= 100 ? " over" : pct >= 80 ? " warn" : "");
    }).catch(function () { /* not signed in yet */ });
  };

  HL.toast = function (msg, isErr) {
    var wrap = HL.$("toastWrap");
    var el = HL.el("div", "toast" + (isErr ? " err" : " ok"), msg);
    wrap.appendChild(el);
    setTimeout(function () { el.classList.add("out"); }, 3400);
    setTimeout(function () { el.remove(); }, 3850);
  };

  // Enhanced feedback for user actions
  HL.showLoading = function (msg) {
    var id = "load" + Math.random().toString(36).slice(2, 8);
    var el = HL.el("div", "work-pill");
    el.id = id;
    el.innerHTML = '<span class="wp-spin"></span><span class="wp-text">' + HL.esc(msg || "Loading…") + "</span>";
    document.body.appendChild(el);
    return function (finalMsg, isError) {
      var el2 = document.getElementById(id);
      if (el2) el2.remove();
      if (finalMsg) HL.toast(finalMsg, isError);
    };
  };

  HL.success = function (msg) {
    HL.toast(msg);
  };

  HL.error = function (msg) {
    HL.toast(msg, true);
  };

  HL.fmtWhen = function (iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  };
  HL.fmtTime = function (iso) {
    return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  };
  HL.fmtDay = function (iso) {
    return new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  };

  HL.PLAT_ICONS = {
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="0.8" fill="currentColor"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V5h-3a4 4 0 0 0-4 4v2H7v3h3v7h3v-7h3l1-3h-4V9a1 1 0 0 1 1-1z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4v8.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.4 2.4 2 4 4.5 4.3"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 10v7M8 7v.1M12 17v-4a2 2 0 0 1 4 0v4"/></svg>',
  };

  /* ---------- modal ---------- */
  HL.modal = function (title, bodyEl, onSave, saveLabel) {
    var back = HL.$("modalBackdrop"), m = HL.$("modal");
    m.innerHTML = "";
    m.appendChild(HL.el("h3", null, title));
    m.appendChild(bodyEl);
    var foot = HL.el("div", "m-foot");
    var cancel = HL.el("button", "btn ghost", "Cancel");
    cancel.addEventListener("click", HL.closeModal);
    foot.appendChild(cancel);
    if (onSave) {
      var save = HL.el("button", "btn", saveLabel || "Save");
      var saving = false;
      save.addEventListener("click", function () {
        if (saving) return;
        saving = true;
        save.disabled = true;
        Promise.resolve(onSave()).then(function (keepOpen) {
          saving = false;
          save.disabled = false;
          if (!keepOpen) HL.closeModal();
        }).catch(function (e) {
          saving = false;
          save.disabled = false;
          var msg = e.message || "Something went wrong";
          HL.toast(msg, true);
          // Add helpful context in buddy
          if (e.action) {
            HL.buddy.show("Oops: " + msg + ". " + e.action);
          }
        });
      });
      foot.appendChild(save);
    }
    m.appendChild(foot);
    back.hidden = false;
    var first = m.querySelector("input,select,textarea");
    if (first) first.focus();
  };
  HL.closeModal = function () { HL.$("modalBackdrop").hidden = true; };

  /* ---------- watching a website scan happen ----------
     Reading a site takes a minute. The server has always written its real
     progress to /api/scan — which page it's on, how many it has read, how
     many photos it found — and nothing watched it, so the owner stared at a
     frozen button and had no idea whether it was working.

     Every row below appears because a page was genuinely fetched and read.
     The counts are the server's counts. If the crawl dies, the real reason
     is what gets shown. */
  HL.scanWatch = function (url, opts) {
    opts = opts || {};
    var back = HL.$("modalBackdrop"), m = HL.$("modal");
    m.innerHTML = "";
    m.classList.add("scan-modal");

    var head = HL.el("div", "scan-head");
    var orb = HL.el("div", "scan-orb");
    orb.innerHTML = '<span class="scan-ring"></span><span class="scan-doc"></span>';
    head.appendChild(orb);
    var ht = HL.el("div");
    ht.appendChild(HL.el("div", "scan-title", "Reading your website"));
    var hostName = url;
    try { hostName = new URL(/^https?:/.test(url) ? url : "https://" + url).hostname; } catch (e) { /* show it raw */ }
    ht.appendChild(HL.el("div", "scan-host", hostName));
    head.appendChild(ht);
    m.appendChild(head);

    var step = HL.el("div", "scan-step", "Opening the site…");
    m.appendChild(step);

    var counts = HL.el("div", "scan-counts");
    var cPages = HL.el("div", "scan-count");
    cPages.innerHTML = '<b>0</b><span>pages read</span>';
    var cPhotos = HL.el("div", "scan-count");
    cPhotos.innerHTML = '<b>0</b><span>photos found</span>';
    counts.appendChild(cPages); counts.appendChild(cPhotos);
    m.appendChild(counts);

    var list = HL.el("div", "scan-list");
    m.appendChild(list);

    var foot = HL.el("div", "m-foot");
    var close = HL.el("button", "btn ghost", "Hide");
    close.title = "The scan keeps going in the background";
    close.addEventListener("click", function () { stop(); HL.closeModal(); });
    foot.appendChild(close);
    m.appendChild(foot);
    back.hidden = false;

    var seen = {};        // url -> row, so a page never lists twice
    var timer = null, stopped = false;
    function stop() { stopped = true; clearInterval(timer); m.classList.remove("scan-modal"); }

    function paint(scan) {
      if (scan.step) step.textContent = scan.step;
      cPages.querySelector("b").textContent = scan.pagesRead || 0;
      cPhotos.querySelector("b").textContent = scan.imagesFound || 0;
      (scan.visited || []).forEach(function (v) {
        if (seen[v.url]) return;
        var row = HL.el("div", "scan-row");
        row.innerHTML = '<span class="scan-tick">✓</span>';
        var t = HL.el("div", "scan-rowt");
        t.appendChild(HL.el("div", "scan-rname", v.title || v.url));
        t.appendChild(HL.el("div", "scan-rurl", v.url));
        row.appendChild(t);
        list.appendChild(row);
        list.scrollTop = list.scrollHeight;
        seen[v.url] = row;
      });
      m.classList.toggle("thinking", scan.status === "thinking");
    }

    return new Promise(function (resolve, reject) {
      timer = setInterval(function () {
        if (stopped) return;
        HL.api("/api/scan").then(function (out) {
          var scan = out.scan || {};
          paint(scan);
          if (scan.status === "done") {
            stop();
            step.textContent = scan.step || "Done";
            m.classList.add("scan-done");
            orb.classList.add("done");
            close.textContent = "Great";
            close.className = "btn";
            resolve(scan);
            if (opts.onDone) opts.onDone(scan);
          } else if (scan.status === "failed") {
            stop();
            m.classList.add("scan-failed");
            step.textContent = scan.error || "The scan failed.";
            close.textContent = "Close";
            reject(new Error(scan.error || "The scan failed."));
          }
        }).catch(function () { /* a dropped poll is not a failed scan */ });
      }, 700);
    });
  };

  /* ---------- shared widgets ---------- */
  HL.stat = function (label, value, sub, accent) {
    var d = HL.el("div", "stat" + (accent ? " accent" : ""));
    d.appendChild(HL.el("div", "s-label", label));
    var v = HL.el("div", "s-value" + (value === null || value === undefined ? " na" : ""));
    v.textContent = value === null || value === undefined ? "Not connected" : value;
    d.appendChild(v);
    if (sub) d.appendChild(HL.el("div", "s-sub", sub));
    return d;
  };

  // Simple multi-series SVG line chart from /api/stats series.
  HL.lineChart = function (series, keys, colors, height) {
    var W = 720, H = height || 180, PAD = 8;
    var max = 1;
    series.forEach(function (d) { keys.forEach(function (k) { if (d[k] > max) max = d[k]; }); });
    var stepX = (W - PAD * 2) / Math.max(1, series.length - 1);
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="chart">';
    // gridlines
    for (var g = 1; g <= 3; g++) {
      var gy = PAD + ((H - PAD * 2) / 4) * g;
      svg += '<line x1="' + PAD + '" y1="' + gy + '" x2="' + (W - PAD) + '" y2="' + gy + '" stroke="rgba(255,255,255,.06)" stroke-width="1"/>';
    }
    keys.forEach(function (k, ki) {
      var pts = series.map(function (d, i) {
        var x = PAD + i * stepX;
        var y = H - PAD - (d[k] / max) * (H - PAD * 2 - 14);
        return x.toFixed(1) + "," + y.toFixed(1);
      });
      svg += '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + colors[ki] + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
      // area fill for first series
      if (ki === 0) {
        svg += '<polygon points="' + PAD + "," + (H - PAD) + " " + pts.join(" ") + " " + (W - PAD) + "," + (H - PAD) + '" fill="' + colors[ki] + '" opacity="0.07"/>';
      }
    });
    svg += "</svg>";
    var wrap = HL.el("div", "chart-wrap");
    wrap.innerHTML = svg;
    return wrap;
  };

  HL.legend = function (labels, colors) {
    var l = HL.el("div", "chart-legend");
    labels.forEach(function (t, i) {
      var s = HL.el("span");
      var i2 = HL.el("i");
      i2.style.background = colors[i];
      s.appendChild(i2);
      s.appendChild(document.createTextNode(t));
      l.appendChild(s);
    });
    return l;
  };

  HL.activityFeed = function (items, limit) {
    var box = HL.el("div");
    box.style.padding = "10px 18px";
    if (!items.length) {
      box.appendChild(HL.emptyState("", "Nothing yet — activity from you and your AI team lands here."));
      return box;
    }
    items.slice(0, limit || 14).forEach(function (a) {
      var r = HL.el("div", "act-row" + (a.type === "published" ? " pub" : a.type === "automation" ? " automation" : ""));
      r.appendChild(HL.el("span", "act-time", HL.fmtTime(a.at)));
      r.appendChild(HL.el("span", "act-dot"));
      r.appendChild(HL.el("span", null, a.message));
      box.appendChild(r);
    });
    return box;
  };

  HL.emptyState = function (emoji, text, btnLabel, btnFn) {
    var d = HL.el("div", "empty");
    var ico = HL.el("div", "e-ico");
    ico.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="url(#gradStroke)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>';
    d.appendChild(ico);
    d.appendChild(HL.el("p", null, text));
    if (btnLabel) {
      var b = HL.el("button", "btn sm", btnLabel);
      b.addEventListener("click", btnFn);
      d.appendChild(b);
    }
    return d;
  };

  HL.panel = function (title, hint) {
    var p = HL.el("section", "panel");
    var h = HL.el("div", "panel-head");
    h.appendChild(HL.el("h2", null, title));
    if (hint !== undefined && hint !== null) h.appendChild(HL.el("span", "hint", hint));
    p.appendChild(h);
    return p;
  };

  HL.setupNote = function (html) {
    var d = HL.el("div", "setup-note");
    d.innerHTML = '<div>' + html + "</div>";
    return d;
  };

  HL.switchEl = function (checked, onChange) {
    var l = HL.el("label", "switch");
    var i = document.createElement("input");
    i.type = "checkbox";
    i.checked = !!checked;
    i.addEventListener("change", function () { onChange(i.checked); });
    l.appendChild(i);
    l.appendChild(HL.el("span", "trk"));
    l.appendChild(HL.el("span", "thb"));
    return l;
  };

  HL.field = function (label, inputEl, hint) {
    var f = HL.el("div", "field");
    var lb = HL.el("label", null, label);
    f.appendChild(lb);
    f.appendChild(inputEl);
    if (hint) f.appendChild(HL.el("span", "field-hint", hint));
    return f;
  };

  HL.fieldError = function (fieldEl, errorMsg) {
    fieldEl.classList.add("error");
    var hint = fieldEl.querySelector(".field-hint");
    if (hint) hint.textContent = errorMsg;
    else fieldEl.appendChild(HL.el("span", "field-hint", errorMsg));
  };

  HL.fieldClear = function (fieldEl) {
    fieldEl.classList.remove("error");
  };

  HL.input = function (placeholder, value) {
    var i = document.createElement("input");
    i.className = "input";
    if (placeholder) i.placeholder = placeholder;
    if (value !== undefined) i.value = value;
    return i;
  };
  HL.select = function (options, value) {
    var s = document.createElement("select");
    s.className = "select";
    options.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o.value !== undefined ? o.value : o;
      op.textContent = o.label !== undefined ? o.label : o;
      s.appendChild(op);
    });
    if (value !== undefined) s.value = value;
    return s;
  };

  /* ---------- navigation ---------- */
  var IC = {
    overview: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>',
    employees: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5c2.8.3 5 2.7 5 5.5"/></svg>',
    automations: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
    social: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.3A8.4 8.4 0 1 1 21 11.5z"/></svg>',
    inbox: '<svg viewBox="0 0 24 24"><path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2z"/></svg>',
    crm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    website: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>',
    appointments: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    email: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 8l9 6 9-6"/></svg>',
    analytics: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    integrations: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/></svg>',
    team: '<svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c0-3 2.7-5 6-5s6 2 6 5M13.5 15.5c.8-.3 1.6-.5 2.5-.5 3.3 0 6 2 6 5"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    billing: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/></svg>',
  };

  /* Three plain groups. Pages that still need an integration live in a
     collapsed "Coming soon" drawer so the everyday sidebar stays short. */
  HL.NAV = [
    { id: "overview", label: "Home", icon: IC.overview },
    { id: "employees", label: "AI Team", icon: IC.employees },
    { id: "automations", label: "Automations", icon: IC.automations },
    { sep: "Your business" },
    { id: "social", label: "Social", icon: IC.social },
    { id: "website", label: "Website", icon: IC.website },
    { id: "crm", label: "Customers", icon: IC.crm },
    { id: "appointments", label: "Appointments", icon: IC.appointments },
    { id: "analytics", label: "Analytics", icon: IC.analytics },
    { sep: "Account" },
    { id: "integrations", label: "Connections", icon: IC.integrations, admin: true },
    { id: "team", label: "My Team", icon: IC.team },
    { id: "settings", label: "Settings", icon: IC.settings },
    { id: "billing", label: "Billing", icon: IC.billing },
    { sep: "Coming soon", soon: true },
    { id: "inbox", label: "Unified Inbox", icon: IC.inbox, badge: "setup", soon: true },
    { id: "phone", label: "AI Phone", icon: IC.phone, badge: "setup", soon: true },
    { id: "email", label: "Email & SMS", icon: IC.email, badge: "setup", soon: true },
    { sep: "HarperLinks HQ", admin: true },
    { id: "accounts", label: "Customer Accounts", icon: IC.team, admin: true },
  ];

  function renderNav() {
    var nav = HL.$("sideNav");
    nav.innerHTML = "";
    var isAdmin = HL.user && HL.user.role === "admin";
    var soonOpen = false;
    try { soonOpen = localStorage.getItem("hl-nav-soon") === "1"; } catch (e) { /* ignore */ }
    var soonWrap = null;

    HL.NAV.forEach(function (item) {
      if (item.admin && !isAdmin) return; // customers never see HQ pages

      if (item.sep && item.soon) {
        // the "Coming soon" drawer: a toggle plus a collapsible container
        var tog = HL.el("button", "side-sep side-soon" + (soonOpen ? " open" : ""));
        tog.type = "button";
        tog.innerHTML = item.sep + ' <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
        soonWrap = HL.el("div", "soon-wrap" + (soonOpen ? " open" : ""));
        // bind THIS wrap element — the shared `soonWrap` variable gets reset
        // by the next section header, which would null out the handler
        var thisWrap = soonWrap;
        tog.addEventListener("click", function () {
          var open = !thisWrap.classList.contains("open");
          thisWrap.classList.toggle("open", open);
          tog.classList.toggle("open", open);
          try { localStorage.setItem("hl-nav-soon", open ? "1" : "0"); } catch (e) { /* ignore */ }
        });
        nav.appendChild(tog);
        nav.appendChild(soonWrap);
        return;
      }
      if (item.sep) {
        soonWrap = null;
        nav.appendChild(HL.el("div", "side-sep", item.sep));
        return;
      }

      var a = HL.el("a", "side-link");
      a.href = "#/" + item.id;
      a.dataset.page = item.id;
      a.innerHTML = item.icon + "<span>" + item.label + "</span>" + (item.badge ? '<span class="nbadge">' + item.badge + "</span>" : "");
      (item.soon && soonWrap ? soonWrap : nav).appendChild(a);
    });
  }

  /* ---------- router ---------- */
  var current = null;
  HL.navigate = function () {
    var id = (location.hash || "#/overview").replace(/^#\//, "").split("?")[0] || "overview";
    var page = HL.pages[id] || HL.pages.overview;
    current = id;
    document.querySelectorAll(".side-link").forEach(function (a) {
      a.classList.toggle("active", a.dataset.page === id);
    });
    var titleEl = HL.$("pageTitle");
    titleEl.textContent = page.title;
    titleEl.classList.remove("tswap");
    void titleEl.offsetWidth;
    titleEl.classList.add("tswap");
    var view = HL.$("view");
    view.innerHTML = "";
    // skeleton while loading
    var skel = HL.el("div", "skel");
    skel.style.height = "120px";
    view.appendChild(skel);
    Promise.resolve(page.render()).then(function (el) {
      if (current !== id) return; // user navigated away mid-load
      view.innerHTML = "";
      view.appendChild(el);
      HL.repaintBusy();
    }).catch(function (e) {
      view.innerHTML = "";
      view.appendChild(HL.emptyState("⚠️", "This page hit a snag: " + e.message, "Retry", HL.navigate));
    });
    HL.$("sidebar").classList.remove("open");
  };

  /* ---------- the setup checklist ----------
     Bottom-right, above the buddy. Every tick is read from real account
     state on the server — a step goes green because the thing actually
     happened, not because someone clicked "done". */
  HL.mountSetup = function () {
    if (document.getElementById("hlSetup")) return;
    // Don't gate on HL.user here — this runs before /api/me has answered.
    // The server tells us whether the checklist applies to this account.

    var box = HL.el("div", "setup-box");
    box.id = "hlSetup";
    document.body.appendChild(box);

    function render(d) {
      if (!d || !d.ok || !d.applies || d.dismissed || d.complete) { box.remove(); return; }
      box.innerHTML = "";

      var head = HL.el("button", "setup-head");
      head.type = "button";
      head.innerHTML =
        '<span class="setup-ring"><i style="--p:' + Math.round((d.done / d.total) * 100) + '"></i>' +
        '<b>' + d.done + '/' + d.total + '</b></span>' +
        '<span class="setup-ht"><b>Finish setting up</b><span>' +
        (d.done ? d.total - d.done : d.total) + ' thing' + ((d.total - d.done) === 1 ? '' : 's') + ' left</span></span>' +
        '<span class="setup-chev">▾</span>';
      head.addEventListener("click", function () { box.classList.toggle("open"); });
      box.appendChild(head);

      var list = HL.el("div", "setup-list");
      d.steps.forEach(function (st) {
        var row = HL.el("div", "setup-step" + (st.done ? " done" : ""));
        row.innerHTML = '<span class="setup-tick">' + (st.done ? "✓" : "") + "</span>";
        var mid = HL.el("div", "setup-mid");
        mid.appendChild(HL.el("div", "setup-t", st.title));
        mid.appendChild(HL.el("div", "setup-b", st.detail || st.body));
        if (!st.done) {
          var go = HL.el("button", "btn sm", st.cta);
          go.addEventListener("click", function (e) {
            e.stopPropagation();
            if (HL.buddy) HL.buddy.goToPage(st.page, st.cta);
            else location.hash = "#/" + st.page;
          });
          mid.appendChild(go);
          // the very first step gets the "I haven't got one" escape hatch
          if (st.id === "website" && !d.noWebsite) {
            var no = HL.el("button", "setup-alt", "I haven't got a website");
            no.addEventListener("click", function (e) {
              e.stopPropagation();
              HL.post("/api/setup", { noWebsite: true }).then(load);
            });
            mid.appendChild(no);
          }
        }
        row.appendChild(mid);
        list.appendChild(row);
      });

      var foot = HL.el("div", "setup-foot");
      var hide = HL.el("button", "setup-alt", "Hide this");
      hide.addEventListener("click", function () {
        HL.post("/api/setup", { dismissed: true }).then(function () { box.remove(); });
      });
      foot.appendChild(hide);
      list.appendChild(foot);
      box.appendChild(list);
    }

    function load() { return HL.api("/api/setup").then(render).catch(function () { box.remove(); }); }
    HL.refreshSetup = load;
    load();
    // re-check after any navigation — finishing a step should tick it off
    window.addEventListener("hashchange", function () { setTimeout(load, 900); });
  };

  HL.refreshHealth = function () {
    HL.api("/api/health").then(function (h) {
      var badge = HL.$("modeBadge"), label = HL.$("modeLabel");
      badge.classList.remove("live", "demo");
      badge.classList.add(h.mode === "live" ? "live" : "demo");
      label.textContent = h.mode === "live" ? "Live · Claude" : "Demo mode";
      HL.mode = h.mode;
    }).catch(function () { HL.$("modeLabel").textContent = "Offline"; });
  };

  /* ======================= MARKETING SITE LINK =======================
     The public website is a separate deployment now. Put its URL here and
     a "Site ↗" link appears in the top bar; leave it empty and it stays
     hidden rather than pointing at a dead address.
     ==================================================================== */
  HL.SITE_URL = "";

  /* ---------- boot ---------- */
  HL.boot = function () {
    // Who's signed in decides what renders — nothing draws until we know.
    HL.api("/api/auth/me").then(function (me) {
      HL.user = me.user;

      // Admin working inside a customer's account: unmissable banner + way out
      if (me.impersonating) {
        document.body.classList.add("imp-mode");
        var bar = HL.el("div", "imp-bar");
        bar.innerHTML =
          '<span class="imp-dot"></span><span class="imp-msg">You’re inside <b>' + HL.esc(me.user.name) + "’s</b> account (" +
          HL.esc(me.user.accountId) + ") — everything you do here is theirs.</span>";
        var back = HL.el("button", "imp-back", "← Return to HQ");
        back.addEventListener("click", function () {
          back.disabled = true;
          HL.post("/api/auth/return").then(function () { location.href = "/"; });
        });
        bar.appendChild(back);
        document.body.prepend(bar);
      }

      var chip = HL.$("userChip");
      if (chip) {
        chip.textContent = me.user.name + (me.user.role === "admin" ? " · HQ" : "");
        chip.hidden = false;
        chip.style.cursor = "pointer";
        chip.title = "Change password";
        chip.addEventListener("click", function () {
          var body = HL.el("div");
          var cur = HL.input("Current password"); cur.type = "password";
          var nxt = HL.input("New password — at least 8 characters"); nxt.type = "password";
          body.appendChild(HL.field("Current password", cur));
          body.appendChild(HL.field("New password", nxt));
          HL.modal("Change password", body, function () {
            return HL.post("/api/auth/password", { current: cur.value, next: nxt.value })
              .then(function () { HL.toast("Password changed"); });
          }, "Change");
        });
      }
      var out = HL.$("logoutBtn");
      if (out) {
        out.hidden = false;
        out.addEventListener("click", function () {
          HL.post("/api/auth/logout").then(function () { location.href = "/login.html"; });
        });
      }
      bootShell();
    }).catch(function (e) {
      // A 401 redirects to /login.html inside HL.api, so reaching here with a
      // real error means the shell failed to build. Swallowing that silently
      // meant half the dashboard could be missing with nothing in the console.
      if (e && !/sign in/i.test(e.message || "")) console.error("Dashboard failed to start:", e);
    });
  };

  /* ================= buddy guide =================
     Little AI friend that flies around helping new users find their way.
     Has personality, remembers context, and provides smart guidance. */
  HL.buddy = {
    isMinimized: false,
    lastMessage: null,
    messageQueue: [],

    show: function (text, opts) {
      opts = opts || {};
      var container = HL.$("buddyContainer");
      var textEl = HL.$("buddyText");
      var actionsEl = HL.$("buddyActions");

      container.hidden = false;
      container.classList.remove("minimized", "thinking", "happy", "waving", "celebrating");
      HL.buddy.isMinimized = false;
      HL.buddy.lastMessage = text;

      // Type out the text for a more natural feel
      textEl.textContent = "";
      var i = 0;
      var typeSpeed = opts.instant ? 0 : 18;
      function typeChar() {
        if (i < text.length) {
          textEl.textContent += text.charAt(i);
          i++;
          if (typeSpeed > 0) setTimeout(typeChar, typeSpeed);
          else textEl.textContent = text;
        }
      }
      typeChar();

      // Clear and add action buttons
      actionsEl.innerHTML = "";
      if (opts.actions) {
        opts.actions.forEach(function (action) {
          var btn = HL.el("button", "btn" + (action.primary ? "" : " ghost"), action.label);
          btn.addEventListener("click", function () {
            if (action.onClick) action.onClick();
          });
          actionsEl.appendChild(btn);
        });
      }

      // Apply mood
      if (opts.mood) container.classList.add(opts.mood);

      return HL.buddy;
    },

    hide: function () {
      var container = HL.$("buddyContainer");
      container.hidden = true;
      container.classList.remove("thinking", "happy", "waving", "celebrating", "minimized");
      HL.buddy.isMinimized = false;
    },

    minimize: function () {
      var container = HL.$("buddyContainer");
      container.classList.add("minimized");
      HL.buddy.isMinimized = true;
    },

    thinking: function (text) {
      return HL.buddy.show(text, { mood: "thinking", instant: true });
    },

    happy: function (text, opts) {
      return HL.buddy.show(text, Object.assign({ mood: "happy" }, opts || {}));
    },

    celebrate: function (text, opts) {
      var container = HL.$("buddyContainer");
      HL.buddy.show(text, Object.assign({ mood: "celebrating" }, opts || {}));
      // Add confetti
      HL.buddy.confetti();
      return HL.buddy;
    },

    wave: function () {
      HL.$("buddyContainer").classList.add("waving");
      setTimeout(function () {
        HL.$("buddyContainer").classList.remove("waving");
      }, 1500);
    },

    confetti: function () {
      var colors = ["#0A84FF", "#FF2D92", "#7B5CFF", "#16A34A", "#F59E0B"];
      var container = document.body;
      for (var i = 0; i < 50; i++) {
        var confetto = HL.el("div");
        confetto.style.cssText = "position:fixed;width:8px;height:8px;border-radius:2px;pointer-events:none;z-index:9999;";
        confetto.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetto.style.left = (Math.random() * 100) + "vw";
        confetto.style.top = "-10px";
        confetto.style.animation = "confettiFall " + (2 + Math.random() * 2) + "s ease-out forwards";
        confetto.style.animationDelay = (Math.random() * 0.5) + "s";
        container.appendChild(confetto);
        setTimeout(function (el) { el.remove(); }.bind(null, confetto), 4500);
      }
    },

    // Smart contextual tips based on current page
    tip: function (page) {
      var tips = {
        overview: [
          "Try saying 'Plan my week's content' to get started!",
          "Click on any AI team member to chat with them directly.",
          "Your AI team works 24/7 — even when you're not here.",
        ],
        social: [
          "I can write posts for all your platforms at once!",
          "Try 'Make me a week of Instagram content'.",
          "Scheduled posts go out automatically — no need to watch the clock.",
        ],
        crm: [
          "New leads appear here automatically from your website.",
          "I can follow up with cold leads — just ask!",
          "Click any lead to see their full history.",
        ],
        employees: [
          "Each AI employee has their own specialty.",
          "Switch between Assisted, Supervised, and Autonomous modes.",
          "Turn employees on or off based on what you need.",
        ],
      };
      var pageTips = tips[page] || tips.overview;
      var tip = pageTips[Math.floor(Math.random() * pageTips.length)];
      return HL.buddy.show("💡 " + tip, { actions: [{ label: "Got it", onClick: HL.buddy.minimize }] });
    },

    // Greetings based on time of day
    greet: function (name) {
      var hr = new Date().getHours();
      var greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
      var msg = name ? greeting + ", " + name + "!" : greeting + "!";
      HL.buddy.wave();
      return HL.buddy.show(msg + " I'm your AI assistant. How can I help today?", {
        mood: "happy",
        actions: [
          { label: "Show me around", primary: true, onClick: HL.startSetupWizard },
          { label: "I'm good", onClick: HL.buddy.minimize },
        ]
      });
    },
  };

  // Add confetti animation to CSS dynamically
  (function () {
    var style = document.createElement("style");
    style.textContent = "@keyframes confettiFall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }";
    document.head.appendChild(style);
  })();

  // Make buddy's eyes follow the cursor for extra personality
  (function () {
    var lastX = 0, lastY = 0;
    document.addEventListener("mousemove", function (e) {
      var buddy = HL.$("buddyChar");
      if (!buddy || buddy.offsetParent === null) return;

      var rect = buddy.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;

      var dx = e.clientX - centerX;
      var dy = e.clientY - centerY;
      var dist = Math.sqrt(dx * dx + dy * dy);

      // Only move eyes if cursor is reasonably close
      if (dist < 400) {
        var maxMove = 2;
        var moveX = Math.max(-maxMove, Math.min(maxMove, dx / 100));
        var moveY = Math.max(-maxMove, Math.min(maxMove, dy / 100));

        var eyes = buddy.querySelectorAll(".buddy-eye");
        eyes.forEach(function (eye) {
          eye.style.transform = "translate(" + moveX + "px, " + moveY + "px)";
        });
      }
    });
  })();

  /* ================= setup wizard =================
     Guides new users through setup with the buddy providing encouragement */
  var SETUP_STEPS = [
    {
      id: "welcome",
      icon: "👋",
      title: "Welcome to HarperLinks!",
      buddyMsg: "Hey there! I'm Spark, your AI guide. Let's get your business running on autopilot!",
      buddyMood: "waving",
    },
    {
      id: "api-key",
      icon: "🔑",
      title: "Power up your AI team",
      buddyMsg: "Your AI employees need a brain to think with. Let's connect Claude!",
      hint: "Get your key free at console.anthropic.com — takes 2 minutes",
      fields: [
        { id: "apiKey", label: "Anthropic API Key", type: "password", placeholder: "sk-ant-...", required: true }
      ],
      onSave: function (data) {
        if (!data.apiKey) throw new Error("Please paste your API key");
        return HL.post("/api/settings/api-key", { key: data.apiKey }).catch(function () {
          return Promise.resolve(); // Continue even if endpoint doesn't exist yet
        });
      },
    },
    {
      id: "profile",
      icon: "🏢",
      title: "Tell us about your business",
      buddyMsg: "This helps your AI team speak in your voice and understand what you do.",
      fields: [
        { id: "businessName", label: "Business name", placeholder: "e.g. Sunrise Wellness", required: true },
        { id: "industry", label: "Industry", type: "select", options: ["Health & Wellness", "Professional Services", "Retail & E-commerce", "Food & Hospitality", "Creative & Media", "Technology", "Education", "Other"] },
        { id: "description", label: "What do you do?", type: "textarea", placeholder: "We help busy professionals find balance through yoga, massage, and mindfulness coaching..." },
      ],
      onSave: function (data) {
        if (!data.businessName) throw new Error("Please tell us your business name");
        return HL.post("/api/profile", { name: data.businessName, industry: data.industry, description: data.description }).catch(function () {
          return Promise.resolve();
        });
      },
    },
    {
      id: "website",
      icon: "🌐",
      title: "Got a website?",
      buddyMsg: "If you paste your URL, I can read your whole site and learn everything about your business instantly!",
      optional: true,
      fields: [
        { id: "websiteUrl", label: "Website URL", placeholder: "https://yourbusiness.com", hint: "Optional — but highly recommended!" }
      ],
      onSave: function (data) {
        if (data.websiteUrl && data.websiteUrl.trim()) {
          // Trigger website scan
          return HL.post("/api/ingest", { url: data.websiteUrl }).catch(function () {
            return Promise.resolve();
          });
        }
        return Promise.resolve();
      },
    },
    {
      id: "complete",
      icon: "🎉",
      title: "You're all set!",
      buddyMsg: "Your AI team is ready to work! Meet them on your Command Centre.",
      buddyMood: "celebrating",
      complete: true,
    },
  ];

  HL.startSetupWizard = function () {
    var currentStep = 0;
    var formData = {};
    HL.buddy.hide();

    function renderStep() {
      var step = SETUP_STEPS[currentStep];
      var totalSteps = SETUP_STEPS.length;

      // Build modal content
      var body = HL.el("div", "wizard-step");

      // Progress bar
      var progress = HL.el("div", "wizard-progress");
      progress.innerHTML = '<div class="wp-bar"><div class="wp-fill" style="width:' + ((currentStep / (totalSteps - 1)) * 100) + '%"></div></div>' +
        '<span class="wp-label">Step ' + (currentStep + 1) + ' of ' + totalSteps + '</span>';
      body.appendChild(progress);

      // Icon
      var iconEl = HL.el("div", "wizard-icon", step.icon);
      body.appendChild(iconEl);

      // Hint text
      if (step.hint) {
        var hint = HL.el("p", "wizard-hint", step.hint);
        body.appendChild(hint);
      }

      // Form fields
      var fieldEls = {};
      if (step.fields) {
        var form = HL.el("div", "wizard-form");
        step.fields.forEach(function (f) {
          var input;
          if (f.type === "textarea") {
            input = HL.el("textarea", "textarea");
            input.placeholder = f.placeholder || "";
          } else if (f.type === "select") {
            input = HL.el("select", "select");
            input.innerHTML = '<option value="">Select...</option>' +
              f.options.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join("");
          } else {
            input = HL.input(f.placeholder);
            if (f.type) input.type = f.type;
          }
          if (formData[f.id]) input.value = formData[f.id];
          fieldEls[f.id] = input;
          form.appendChild(HL.field(f.label, input, f.hint));
        });
        body.appendChild(form);
      }

      // Show buddy message
      setTimeout(function () {
        var container = HL.$("buddyContainer");
        container.hidden = false;
        if (step.buddyMood === "waving") HL.buddy.wave();
        HL.buddy.show(step.buddyMsg, { mood: step.buddyMood === "celebrating" ? "happy" : null });
      }, 300);

      // Action button text
      var actionText = step.complete ? "Let's go!" : (step.optional ? "Skip" : "Continue");
      var hasRequiredEmpty = step.fields && step.fields.some(function (f) { return f.required; });

      HL.modal(step.title, body, function () {
        // Gather form data
        if (step.fields) {
          step.fields.forEach(function (f) {
            formData[f.id] = fieldEls[f.id].value;
          });
        }

        // Validate and save
        if (step.onSave) {
          HL.buddy.thinking("Working on it...");
          return step.onSave(formData).then(function () {
            nextStep();
          }).catch(function (e) {
            HL.buddy.show("Oops! " + e.message, { mood: "thinking" });
            throw e;
          });
        } else {
          nextStep();
        }
      }, actionText);

      // Add skip button for optional steps
      if (step.optional && !step.complete) {
        var foot = document.querySelector(".m-foot");
        if (foot) {
          var skip = HL.el("button", "btn ghost", "Skip for now");
          skip.addEventListener("click", function () {
            HL.closeModal();
            nextStep();
          });
          foot.insertBefore(skip, foot.firstChild);
        }
      }
    }

    function nextStep() {
      currentStep++;
      if (currentStep >= SETUP_STEPS.length) {
        completeSetup();
      } else {
        setTimeout(renderStep, 200);
      }
    }

    function completeSetup() {
      HL.closeModal();
      HL.buddy.celebrate("🎉 You're all set! Your AI team is ready to work.", {
        actions: [
          { label: "Meet your team", primary: true, onClick: function () {
            HL.buddy.minimize();
            location.hash = "#/employees";
          }},
          { label: "Start chatting", onClick: function () {
            HL.buddy.minimize();
            location.hash = "#/overview";
          }},
        ]
      });
      localStorage.setItem("hl-setup-complete", "true");
      HL.refreshHealth();
    }

    renderStep();
  };

  function bootShell() {
    renderNav();
    if (HL.SITE_URL && HL.SITE_URL.trim()) {
      var sl = HL.$("siteLink");
      sl.href = HL.SITE_URL.trim();
      sl.target = "_blank";
      sl.rel = "noopener";
      sl.hidden = false;
    }

    // Initialize buddy interactions
    HL.$("buddyDismiss").addEventListener("click", function () {
      HL.buddy.minimize();
    });
    HL.$("buddyChar").addEventListener("click", function () {
      if (HL.buddy.isMinimized) {
        // Show last message or a contextual tip
        var page = (location.hash || "#/overview").replace(/^#\//, "").split("?")[0] || "overview";
        HL.buddy.tip(page);
      } else {
        HL.buddy.minimize();
      }
    });

    HL.$("topDate").textContent = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
    HL.$("sideToggle").addEventListener("click", function () { HL.$("sidebar").classList.toggle("open"); });
    HL.$("modalBackdrop").addEventListener("click", function (e) { if (e.target === HL.$("modalBackdrop")) HL.closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") HL.closeModal(); });
    window.addEventListener("hashchange", function () {
      HL.navigate();
      // Buddy gives contextual tips when navigating (occasionally)
      if (!HL.buddy.isMinimized && Math.random() < 0.3) {
        var page = (location.hash || "#/overview").replace(/^#\//, "").split("?")[0] || "overview";
        setTimeout(function () { HL.buddy.tip(page); }, 1000);
      }
    });
    HL.refreshHealth();
    HL.refreshBudget();
    setInterval(HL.refreshHealth, 30000);
    setInterval(HL.refreshBudget, 45000);

    // Check if this is first time — show welcome or setup wizard
    HL.api("/api/profile").then(function (profile) {
      var setupComplete = localStorage.getItem("hl-setup-complete");
      var setupDismissed = localStorage.getItem("hl-setup-dismissed");

      if (!profile.configured && !setupComplete && !setupDismissed) {
        // First time user — show welcome with setup wizard option
        setTimeout(function () {
          HL.buddy.greet(HL.user && HL.user.name ? HL.user.name.split(" ")[0] : null);
        }, 800);
      } else if (profile.configured && !setupDismissed) {
        // Returning user — show minimized buddy
        setTimeout(function () {
          var container = HL.$("buddyContainer");
          container.hidden = false;
          HL.buddy.minimize();
        }, 1500);
      }
    }).catch(function () {
      // If profile check fails, still show buddy for new users
      setTimeout(function () {
        HL.buddy.greet();
      }, 800);
    });

    HL.navigate();
    if (HL.mountAssistant) HL.mountAssistant();
    if (HL.mountSetup) HL.mountSetup();
  }
})();
