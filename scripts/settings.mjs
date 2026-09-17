import { ID, DEFAULTS, validateDefinitions } from "./model.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TagSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-tag-settings", tag: "form", classes: ["dnd5e-item-tags-settings"],
    window: { title: "Item Tags for D&D5e — настройка тегов", resizable: true },
    position: { width: 780, height: 650 },
    form: { handler: TagSettings.submit, closeOnSubmit: false }
  };
  static PARTS = { main: { template: "modules/dnd5e-item-tags/templates/settings.hbs" } };
  draft = null;
  originalKeys = new Set();
  baseline = "";
  async _prepareContext() {
    if (!this.draft) {
      this.draft = structuredClone(game.settings.get(ID, "definitions"));
      this.baseline = JSON.stringify(this.draft);
      this.originalKeys = new Set(this.draft.map(d => d.key));
    }
    const types = Object.keys(CONFIG.Item.dataModels).filter(k => k !== "base");
    return { rows: this.draft.map((d, index) => ({ ...d, index, existing: this.originalKeys.has(d.key),
      types: ["*", ...types].map(key => ({ key, label: key === "*" ? "Все предметы (включая новые типы)"
        : game.i18n.localize(CONFIG.Item.typeLabels?.[key] ?? key), selected: d.itemTypes.includes(key) }))
    })) };
  }
  collect() {
    return [...this.element.querySelectorAll(".itags-definition")].map(row => ({
      key: row.querySelector('[data-field="key"]').value.trim(),
      label: row.querySelector('[data-field="label"]').value.trim(),
      enabled: row.querySelector('[data-field="enabled"]').checked,
      actors: row.querySelector('[data-field="actors"]').checked,
      effects: row.querySelector('[data-field="effects"]').checked,
      itemTypes: [...row.querySelectorAll('[data-type]:checked')].map(el => el.dataset.type)
    }));
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[data-command="add"]').addEventListener("click", () => {
      this.draft = this.collect();
      this.draft.push({ key: "", label: "", enabled: true, itemTypes: ["*"], actors: false, effects: true });
      this.render({ force: true });
    });
    for (const button of this.element.querySelectorAll('[data-command="discard"]')) button.addEventListener("click", () => {
      this.draft = this.collect();
      this.draft.splice(Number(button.dataset.index), 1);
      this.render({ force: true });
    });
  }
  static async submit() {
    if (!game.user.isGM) return;
    try {
      if (JSON.stringify(game.settings.get(ID, "definitions")) !== this.baseline) {
        throw new Error("Другой ведущий уже изменил список. Закройте и снова откройте настройки перед сохранением.");
      }
      const rows = validateDefinitions(this.collect());
      // Keep established keys immutable; disabling preserves saved instances and formulas.
      if ([...this.originalKeys].some(key => !rows.some(r => r.key === key))) throw new Error("Сохранённый ключ нельзя удалить или изменить. Отключите тег.");
      await game.settings.set(ID, "definitions", rows);
      this.draft = null;
      ui.notifications.info("Теги сохранены. Отключённые отметки сохранены на документах.");
      this.render({ force: true });
    } catch (error) { ui.notifications.error(error.message); }
  }
}

export function registerSettings(refresh) {
  // Reuse saved world settings from the unpublished first name when present.
  const previous = (key, fallback) => {
    const stored = game.settings.storage.get("world")?.get(`intermezzo-tags.${key}`)?.value;
    if (stored === undefined) return fallback;
    try { return typeof stored === "string" ? JSON.parse(stored) : structuredClone(stored); }
    catch { return fallback; }
  };
  let initialDefinitions;
  try { initialDefinitions = validateDefinitions(previous("definitions", DEFAULTS)); }
  catch { initialDefinitions = structuredClone(DEFAULTS); }
  game.settings.register(ID, "definitions", { scope: "world", config: false, type: Array,
    default: initialDefinitions, onChange: refresh });
  game.settings.registerMenu(ID, "configure", { name: "Теги предметов, существ и эффектов",
    label: "Настроить теги", hint: "Добавить тег, изменить название, включить или отключить и выбрать типы документов.",
    icon: "fa-solid fa-tags", type: TagSettings, restricted: true });
  game.settings.register(ID, "enabled", { name: "Включить теги", hint: "При выключении проверки тегов возвращают 0; сохранённые отметки остаются.",
    scope: "world", config: true, type: Boolean, default: previous("enabled", true), onChange: refresh });
  game.settings.register(ID, "gmOnly", { name: "Отмечать теги может только ведущий",
    hint: "Иначе теги может менять владелец документа. Настройка списка тегов всегда доступна только ведущему.",
    scope: "world", config: true, type: Boolean, default: previous("gmOnly", false), onChange: refresh });
  game.settings.register(ID, "nativeProperties", { name: "Показывать в стандартных свойствах D&D5e",
    hint: "Регистрирует свойства itags_… для поддерживаемых типов. Для Custom D&D 5e. После смены перезагрузите мир. Сохранённые свойства остаются.",
    scope: "world", config: true, type: Boolean, default: previous("nativeProperties", true), requiresReload: true });
}
