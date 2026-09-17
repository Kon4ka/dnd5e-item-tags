// World Script Macro: ExperimentalCoreDamage.
// Replace the code of the existing macro, do not add a second DamageBonusMacro effect.
const macroData = args?.[0] ?? {};
const wf = typeof workflow !== "undefined" ? workflow : macroData.workflow;
const rolledItem = wf?.item ?? (typeof item !== "undefined" ? item : undefined);
if (macroData.tag !== "DamageBonus" && macroData.macroPass !== "DamageBonus") return [];
if (!wf || !rolledItem) return [];
const tags = game.modules.get("dnd5e-item-tags")?.api;
const technological = tags ? tags.has(rolledItem, "technological")
  : rolledItem.getFlag("world", "technologicalWeapon") === true;
if (!technological) return [];
if (wf.hitTargets instanceof Set && wf.hitTargets.size === 0) return [];
return [{ damageRoll: `${wf.isCritical ? 2 : 1}d8`, damageType: "force", flavor: "Перегрузка ядра" }];
