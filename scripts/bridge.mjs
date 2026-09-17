import { ID, propertyKey, syncItemUpdate, flagPath, rawTag, applicable } from "./model.mjs";
import { definitions, enabled, map, actorMap } from "./api.mjs";

export function reconcileProperties(target = CONFIG.DND5E.itemProperties) {
  const native = game.settings.get(ID, "nativeProperties");
  const types = CONFIG.DND5E.validProperties;
  for (const def of definitions()) {
    const pk = propertyKey(def.key);
    // Own namespace only. Retain definitions for disabled tags to decode old item data.
    target[pk] = { label: def.label, abbreviation: def.label, isPhysical: false, isTag: true };
    for (const [type, values] of Object.entries(types)) {
      if (!(values instanceof Set)) continue;
      if (native && enabled() && def.enabled && applicable({ documentName: "Item", type }, def)) values.add(pk);
      else values.delete(pk);
    }
  }
}

export function beforeUpdate(item, changes) {
  const patch = syncItemUpdate(item, changes, definitions(), {
    native: game.settings.get(ID, "nativeProperties"), enabled: enabled()
  });
  if (game.settings.get(ID, "gmOnly") && !game.user.isGM
    && definitions().some(d => patch[flagPath(d.key)] !== undefined
      && patch[flagPath(d.key)] !== rawTag(item, d.key, { source: true }))) {
    ui.notifications.warn("Теги этого мира изменяет только ведущий.");
    return false;
  }
  // Foundry can supply expanded or flat changes. Always merge in the same expanded form.
  const expanded = foundry.utils.expandObject(patch);
  for (const key of Object.keys(patch)) delete changes[key];
  foundry.utils.mergeObject(changes, expanded, { inplace: true });
}
export function beforeCreate(item) {
  const changes = {};
  for (const def of definitions()) {
    if (rawTag(item, def.key, { source: true })) changes[flagPath(def.key)] = true;
  }
  beforeUpdate(item, changes);
  if (Object.keys(changes).length) item.updateSource(changes);
}

// WRAPPER, not OVERRIDE: Midi/DAE and other modules still receive their normal roll data.
export function registerRollData() {
  libWrapper.register(ID, "CONFIG.Item.documentClass.prototype.getRollData", function (wrapped, ...args) {
    const data = wrapped(...args);
    return { ...data, item: { ...data.item, itags: map(this) } };
  }, "WRAPPER");
  libWrapper.register(ID, "CONFIG.Actor.documentClass.prototype.getRollData", function (wrapped, ...args) {
    const data = wrapped(...args);
    return { ...data, itags: actorMap(this) };
  }, "WRAPPER");
}
