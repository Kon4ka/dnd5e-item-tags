import { applicable, rawTag, flagPath, ID } from "./model.mjs";
import { definitions, enabled, canEdit, has, set } from "./api.mjs";
import { openSettings } from "./settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
export class DocumentTags extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["dnd5e-item-tags-dialog"],
    window: { title: "Теги", resizable: true }, position: { width: 480 } };
  static PARTS = { main: { template: "modules/dnd5e-item-tags/templates/document.hbs" } };
  constructor(doc) { super(); this.targetDocument = doc; }
  async _prepareContext() { return { name: this.targetDocument.name }; }
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector(".itags-dialog-slot").append(buildTags(this.targetDocument));
  }
}
export const openTags = doc => new DocumentTags(doc).render({ force: true });

function buildTags(doc) {
  const block = document.createElement("div");
  block.className = "dnd5e-item-tags-panel form-group stacked checkbox-grid";
  const heading = document.createElement("div");
  heading.className = "itags-heading";
  const titleLabel = document.createElement("span");
  titleLabel.textContent = "Теги";
  heading.append(titleLabel);
  if (game.user.isGM) {
    const configure = document.createElement("button");
    configure.type = "button";
    configure.className = "itags-configure";
    configure.textContent = "Настроить теги";
    configure.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); openSettings();
    });
    heading.append(configure);
  }
  block.append(heading);
  const grid = document.createElement("div");
  grid.className = "itags-grid";
  block.append(grid);
  const defs = definitions().filter(d => d.enabled && applicable(doc, d));
  if (!enabled() || !defs.length) {
    const message = document.createElement("p");
    message.textContent = "Нет включённых тегов для этого документа. Список настраивается в настройках модуля.";
    block.append(message); return block;
  }
  for (const def of defs) {
    const label = document.createElement("label");
    label.className = "itags-checkbox checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = rawTag(doc, def.key, { source: true });
    input.disabled = !canEdit(doc);
    input.setAttribute("aria-label", def.label);
    const title = document.createElement("span");
    title.textContent = def.label;
    label.title = `${def.key}\n${flagPath(def.key)}`;
    label.append(input, title);
    if (has(doc, def.key) !== input.checked) {
      const badge = document.createElement("small");
      badge.textContent = has(doc, def.key) ? " (включён эффектом)" : " (выключен эффектом)";
      label.append(badge);
    }
    input.addEventListener("change", async event => {
      event.stopPropagation();
      const requested = input.checked;
      input.disabled = true;
      try { await set(doc, def.key, requested); }
      catch (error) { input.checked = !requested; ui.notifications.error(error.message); }
      finally { input.disabled = !canEdit(doc); }
    });
    grid.append(label);
  }
  // No named inputs: parent sheet submission must not persist temporary effect values.
  block.addEventListener("change", e => e.stopPropagation());
  return block;
}

function visible(doc) {
  return ["Item", "Actor", "ActiveEffect"].includes(doc?.documentName)
    && (doc.documentName !== "Item" || game.user.isGM || doc.system?.identified !== false);
}
export function headerControls(app, controls) {
  const doc = app.document;
  if (!visible(doc) || controls.some(c => c.action === "dnd5eItemTags")) return;
  controls.push({ action: "dnd5eItemTags", icon: "fa-solid fa-tags", label: "Теги",
    onClick: () => openTags(doc) });
}
export function renderSheet(app, element) {
  const doc = app.document;
  if (!visible(doc)) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  root.querySelectorAll(".dnd5e-item-tags-panel, .dnd5e-item-tags-open").forEach(el => el.remove());
  // Items edit tags in their native property pool; the separate editor remains available.
  const header = root.querySelector(".sheet-header");
  // Actor tags belong in the window's three-dot menu, not the character banner.
  if (header && doc.documentName === "Item") {
    const button = document.createElement("button");
    button.type = "button"; button.className = "dnd5e-item-tags-open";
    button.textContent = "Теги";
    button.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openTags(doc); });
    header.append(button);
  }
}
export function refreshSheets() {
  for (const app of foundry.applications.instances.values()) {
    if (visible(app.document) || app instanceof DocumentTags) app.render({ force: false });
  }
}
export function refreshDocumentDialogs(doc) {
  for (const app of foundry.applications.instances.values()) {
    if (!(app instanceof DocumentTags)) continue;
    if (app.targetDocument === doc || app.targetDocument === doc.parent) app.render({ force: false });
  }
}
