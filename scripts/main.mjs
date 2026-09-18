import { ID } from "./model.mjs";
import { api } from "./api.mjs";
import { registerSettings } from "./settings.mjs";
import { reconcileProperties, beforeUpdate, beforeCreate, registerRollData } from "./bridge.mjs";
import { headerControls, refreshSheets, refreshDocumentDialogs, openTags } from "./ui.mjs";

Hooks.once("init", () => {
  registerSettings(() => { reconcileProperties(); refreshSheets(); });
  game.modules.get(ID).api = { ...api, open: openTags };
  reconcileProperties();
  Hooks.on("preUpdateItem", beforeUpdate);
  Hooks.on("preCreateItem", beforeCreate);
  // Sole entry point: the window three-dot menu. No button is injected into sheet headers.
  Hooks.on("getHeaderControlsApplicationV2", headerControls);
  for (const name of ["updateItem", "updateActor", "updateActiveEffect", "createActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(name, refreshDocumentDialogs);
  }
  // Custom D&D merges external properties. Its hook precedes a validProperties rebuild.
  Hooks.on("customDnd5e.setItemPropertiesConfig", config => {
    reconcileProperties(config);
    queueMicrotask(() => reconcileProperties());
  });
  Hooks.on("updateSetting", setting => {
    if (setting.key?.startsWith("custom-dnd5e.")) queueMicrotask(() => { reconcileProperties(); refreshSheets(); });
  });
});
Hooks.once("setup", () => { reconcileProperties(); registerRollData(); });
Hooks.once("ready", () => { reconcileProperties(); refreshSheets(); });
