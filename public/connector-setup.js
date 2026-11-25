// Simple connector setup UI - makes connecting services trivial

HL.ConnectorSetup = {
  // Show setup modal for a connector
  async showSetup(connectorId) {
    const res = await HL.api(`/api/connectors/${connectorId}`);
    if (!res) return HL.toast("Connector not found", true);

    const modal = HL.el("div");
    modal.style.cssText = "max-width:500px";

    // Title + description
    const title = HL.el("h3", null, res.name);
    title.style.cssText = "margin:0 0 10px;font-size:20px";
    modal.appendChild(title);

    const desc = HL.el("p", "sec-intro", res.instructions);
    desc.style.cssText = "font-size:13px;margin:0 0 20px";
    modal.appendChild(desc);

    // Setup method: OAuth or API key form
    if (res.setupMethod === "oauth") {
      const connectBtn = HL.el("button", "btn", "Sign in with " + res.name);
      connectBtn.addEventListener("click", async () => {
        try {
          const urlRes = await HL.api(`/api/connectors/${connectorId}/oauth-url`);
          window.open(urlRes.url, "connector_oauth", "width=600,height=800");
          // Poll for completion
          setTimeout(() => HL.navigate(), 3000);
        } catch (e) {
          HL.toast(e.message, true);
        }
      });
      modal.appendChild(connectBtn);
    } else if (res.setupMethod === "api-key") {
      // Simple form for API keys
      const form = HL.el("div");
      const inputs = {};

      (res.fields || []).forEach((field) => {
        const inp = HL.el(field.type === "select" ? "select" : "input");
        inp.placeholder = field.placeholder || field.label;
        if (field.type === "password") inp.type = "password";
        if (field.type === "url") inp.type = "url";
        if (field.type === "tel") inp.type = "tel";
        if (field.type === "select") {
          (field.options || []).forEach((opt) => {
            const optEl = HL.el("option", null, opt);
            optEl.value = opt;
            if (opt === (field.default || "")) optEl.selected = true;
            inp.appendChild(optEl);
          });
        }

        inputs[field.name] = inp;
        form.appendChild(HL.field(field.label, inp));
      });

      const connectBtn = HL.el("button", "btn", "Connect " + res.name);
      connectBtn.addEventListener("click", async () => {
        const config = {};
        (res.fields || []).forEach((field) => {
          config[field.name] = inputs[field.name].value;
        });

        if (Object.values(config).some((v) => !v)) {
          return HL.toast("Fill in all fields", true);
        }

        try {
          connectBtn.disabled = true;
          connectBtn.textContent = "Verifying...";

          const result = await HL.post(`/api/connectors/${connectorId}/setup`, { config });
          HL.toast(result.message || "Connected! 🎉");
          HL.navigate();
        } catch (e) {
          HL.toast(e.message, true);
        } finally {
          connectBtn.disabled = false;
          connectBtn.textContent = "Connect " + res.name;
        }
      });

      form.appendChild(connectBtn);
      modal.appendChild(form);
    }

    HL.modal(`Connect ${res.name}`, modal, null, "");
  },

  // Show all available connectors
  async showAll() {
    const root = HL.el("div");

    const connectors = await HL.api("/api/connectors");
    if (!connectors) return HL.emptyState("⚠️", "Could not load connectors");

    // Group by category
    const byCategory = {};
    connectors.forEach((c) => {
      byCategory[c.category] = byCategory[c.category] || [];
      byCategory[c.category].push(c);
    });

    // Render each category
    Object.entries(byCategory).forEach(([category, items]) => {
      const section = HL.el("div");
      section.style.cssText = "margin:0 0 30px";

      const categoryTitle = HL.el("h4", null, HL.titleCase(category));
      categoryTitle.style.cssText = "margin:0 0 10px;text-transform:uppercase;font-size:12px;color:var(--muted);letter-spacing:0.5px";
      section.appendChild(categoryTitle);

      const grid = HL.el("div", "grid cols-2");
      grid.style.gap = "10px";

      items.forEach((c) => {
        const card = HL.el("div");
        card.style.cssText =
          "padding:12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all 150ms;" +
          "display:flex;align-items:center;gap:10px";
        card.addEventListener("mouseenter", () => (card.style.borderColor = "var(--accent-border)"));
        card.addEventListener("mouseleave", () => (card.style.borderColor = "var(--border)"));

        // Icon
        if (HL.BRAND_ICONS && HL.BRAND_ICONS[c.icon]) {
          const icon = HL.el("div");
          icon.innerHTML = HL.BRAND_ICONS[c.icon];
          icon.style.cssText = "width:28px;height:28px;flex-shrink:0";
          card.appendChild(icon);
        }

        // Text
        const text = HL.el("div");
        text.style.cssText = "flex:1;min-width:0";

        const name = HL.el("div");
        name.style.cssText = "font-size:13px;font-weight:600;margin:0";
        name.textContent = c.name;
        text.appendChild(name);

        const status = HL.el("div");
        status.style.cssText = "font-size:11px;color:var(--muted);margin:2px 0 0";
        status.textContent = c.configured ? "✓ Connected" : "Not connected";
        text.appendChild(status);

        card.appendChild(text);

        card.addEventListener("click", () => HL.ConnectorSetup.showSetup(c.id));

        grid.appendChild(card);
      });

      section.appendChild(grid);
      root.appendChild(section);
    });

    return root;
  },
};

// Helper to title-case strings
HL.titleCase = function (str) {
  return str.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};
