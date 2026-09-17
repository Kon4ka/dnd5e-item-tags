import test from "node:test";
import assert from "node:assert/strict";
import { ID, DEFAULTS } from "../scripts/model.mjs";
const settings = { definitions: structuredClone(DEFAULTS), enabled: true, nativeProperties: true, gmOnly: false };
globalThis.game = { settings: { get: (_id, key) => settings[key] }, user: { isGM: true }, packs: new Map() };
globalThis.CONFIG = { DND5E: { itemProperties: { fin: { label: "Finesse" } }, validProperties: {
  weapon: new Set(["fin"]), spell: new Set(), equipment: new Set(), tool: new Set()
} } };
const api = await import("../scripts/api.mjs");
const bridge = await import("../scripts/bridge.mjs");

test("property registration is idempotent and preserves other modules", () => {
  bridge.reconcileProperties(); bridge.reconcileProperties();
  assert.deepEqual(CONFIG.DND5E.itemProperties.fin, { label: "Finesse" });
  assert.ok(CONFIG.DND5E.validProperties.spell.has("itags_technological"));
  assert.ok(CONFIG.DND5E.validProperties.weapon.has("fin"));
  assert.equal(CONFIG.DND5E.validProperties.weapon.has("itags_magic_user"), false);
});
test("Custom D&D config replacement can be reconciled without replacing foreign entries", () => {
  const foreign = { custom: { label: "Other" } };
  bridge.reconcileProperties(foreign);
  CONFIG.DND5E.itemProperties = foreign;
  CONFIG.DND5E.validProperties.weapon = new Set(["fin", "custom"]);
  bridge.reconcileProperties();
  assert.ok(CONFIG.DND5E.validProperties.weapon.has("custom"));
  assert.ok(CONFIG.DND5E.validProperties.weapon.has("itags_dominion"));
  assert.equal(foreign.custom.label, "Other");
});
test("disabled definitions stay decodable but disappear from native choices", () => {
  settings.definitions[0].enabled = false;
  bridge.reconcileProperties();
  assert.ok(CONFIG.DND5E.itemProperties.itags_technological);
  assert.equal(CONFIG.DND5E.validProperties.weapon.has("itags_technological"), false);
  settings.definitions[0].enabled = true; bridge.reconcileProperties();
});
test("effect metadata classifies a target only while that effect is applied and active", () => {
  const effect = { documentName: "ActiveEffect", flags: { [ID]: { tags: { magic_user: true } } } };
  const actor = { documentName: "Actor", appliedEffects: [effect], items: [] };
  assert.equal(api.actorHas(actor, "magic_user"), true);
  effect.disabled = true;
  assert.equal(api.actorHas(actor, "magic_user"), false);
  effect.disabled = false; effect.isSuppressed = true;
  assert.equal(api.actorHas(actor, "magic_user"), false);
  actor.items.push(effect); actor.appliedEffects = [];
  assert.equal(api.actorHas(actor, "magic_user"), false);
});
test("libWrapper adapters preserve roll data and expose numeric fields usable in Midi sandbox", () => {
  const wrappers = new Map();
  globalThis.libWrapper = { register: (_id, path, fn, mode) => { assert.equal(mode, "WRAPPER"); wrappers.set(path, fn); } };
  bridge.registerRollData();
  const item = { documentName: "Item", type: "weapon", flags: { [ID]: { tags: { technological: true, dominion: true } } } };
  const original = { item: { damage: "1d8" }, prof: 2 };
  const data = wrappers.get("CONFIG.Item.documentClass.prototype.getRollData").call(item, () => original);
  assert.equal(data.prof, 2); assert.equal(data.item.damage, "1d8");
  assert.equal(original.item.itags, undefined);
  const target = { documentName: "Actor", flags: { [ID]: { tags: { magic_user: true } } } };
  data.target = wrappers.get("CONFIG.Actor.documentClass.prototype.getRollData").call(target, () => ({ attributes: { hp: 10 } }));
  const sandbox = new Proxy(data, { has: () => true, get: (obj, key) => key === Symbol.unscopables ? undefined : obj[key] });
  const evaluate = new Function("sandbox", "with (sandbox) { return item.itags.technological && item.itags.dominion && target.itags.magic_user; }");
  assert.equal(evaluate(sandbox), 1);
  settings.definitions[0].enabled = false;
  assert.equal(api.map(item).technological, 0);
  settings.definitions[0].enabled = true;
});
test("source classification follows an effect origin, not actor faction", async () => {
  globalThis.fromUuid = async () => ({ documentName: "Item", type: "spell", flags: { [ID]: { tags: { empire: true } } } });
  assert.equal(await api.sourceHas({ origin: "Actor.A.Item.B" }, "empire"), true);
  assert.equal(await api.sourceHas({ parent: { flags: { [ID]: { tags: { empire: true } } } } }, "empire"), false);
});
test("write API enforces ownership, locked compendiums and disabled tags", async () => {
  const doc = { documentName: "Item", type: "weapon", isOwner: false, update: async patch => patch };
  await assert.rejects(api.set(doc, "technological", true));
  doc.isOwner = true;
  assert.deepEqual(await api.set(doc, "technological", true), { [`flags.${ID}.tags.technological`]: true });
  doc.pack = "locked"; game.packs.set("locked", { locked: true });
  await assert.rejects(api.set(doc, "technological", true));
  delete doc.pack; settings.enabled = false;
  await assert.rejects(api.set(doc, "technological", true));
  settings.enabled = true;
});
