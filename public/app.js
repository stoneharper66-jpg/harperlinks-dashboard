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
        if (!r.ok) throw new Error(d.error || "Request failed");
        return d;
      });
    });
  };
  HL.post = function (path, body, method) {
    return HL.api(path, { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  };

  HL.toast = function (msg, isErr) {
    var el = HL.el("div", "toast" + (isErr ? " err" : ""), msg);
    HL.$("toastWrap").appendChild(el);
    setTimeout(function () { el.remove(); }, 3800);
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
      save.addEventListener("click", function () {
        Promise.resolve(onSave()).then(function (keepOpen) { if (!keepOpen) HL.closeModal(); }).catch(function (e) { HL.toast(e.message, true); });
      });
      foot.appendChild(save);
    }
    m.appendChild(foot);
    back.hidden = false;
    var first = m.querySelector("input,select,textarea");
    if (first) first.focus();
  };
  HL.closeModal = function () { HL.$("modalBackdrop").hidden = true; };

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

  HL.field = function (label, inputEl) {
    var f = HL.el("div", "field");
    var lb = HL.el("label", null, label);
    f.appendChild(lb);
    f.appendChild(inputEl);
    return f;
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

  HL.NAV = [
    { sep: "Run the business" },
    { id: "overview", label: "Command Centre", icon: IC.overview },
    { id: "employees", label: "AI Employees", icon: IC.employees },
    { id: "automations", label: "Automations", icon: IC.automations },
    { sep: "Channels" },
    { id: "social", label: "Social Media", icon: IC.social },
    { id: "inbox", label: "Unified Inbox", icon: IC.inbox, badge: "setup" },
    { id: "phone", label: "AI Phone System", icon: IC.phone, badge: "setup" },
    { id: "email", label: "Email & SMS", icon: IC.email, badge: "setup" },
    { sep: "Customers" },
    { id: "crm", label: "CRM & Leads", icon: IC.crm },
    { id: "appointments", label: "Appointments", icon: IC.appointments },
    { sep: "Grow" },
    { id: "website", label: "Website Manager", icon: IC.website },
    { id: "analytics", label: "Analytics", icon: IC.analytics },
    { sep: "Workspace" },
    { id: "integrations", label: "Integrations", icon: IC.integrations },
    { id: "team", label: "Team", icon: IC.team },
    { id: "settings", label: "Settings & Knowledge", icon: IC.settings },
    { id: "billing", label: "Billing", icon: IC.billing },
  ];

  function renderNav() {
    var nav = HL.$("sideNav");
    nav.innerHTML = "";
    HL.NAV.forEach(function (item) {
      if (item.sep) {
        nav.appendChild(HL.el("div", "side-sep", item.sep));
        return;
      }
      var a = HL.el("a", "side-link");
      a.href = "#/" + item.id;
      a.dataset.page = item.id;
      a.innerHTML = item.icon + "<span>" + item.label + "</span>" + (item.badge ? '<span class="nbadge">' + item.badge + "</span>" : "");
      nav.appendChild(a);
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
    HL.$("pageTitle").textContent = page.title;
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
    }).catch(function (e) {
      view.innerHTML = "";
      view.appendChild(HL.emptyState("⚠️", "This page hit a snag: " + e.message, "Retry", HL.navigate));
    });
    HL.$("sidebar").classList.remove("open");
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
    renderNav();
    if (HL.SITE_URL && HL.SITE_URL.trim()) {
      var sl = HL.$("siteLink");
      sl.href = HL.SITE_URL.trim();
      sl.target = "_blank";
      sl.rel = "noopener";
      sl.hidden = false;
    }
    HL.$("topDate").textContent = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
    HL.$("sideToggle").addEventListener("click", function () { HL.$("sidebar").classList.toggle("open"); });
    HL.$("modalBackdrop").addEventListener("click", function (e) { if (e.target === HL.$("modalBackdrop")) HL.closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") HL.closeModal(); });
    window.addEventListener("hashchange", HL.navigate);
    HL.refreshHealth();
    setInterval(HL.refreshHealth, 30000);
    HL.navigate();
  };
})();
