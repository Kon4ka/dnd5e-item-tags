import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, ID, applicable, hasTag, rawTag, tagMap, syncItemUpdate, validateDefinitions } from "../scripts/model.mjs";
const item = (extra = {}) => ({ documentName: "Item", type: "weapon", system: { properties: new Set() },
  _source: { system: { properties: [] } }, ...extra });

test("renamed module reads old tags but new explicit false wins", () => {
  const doc = item({ flags: { "intermezzo-tags": { tags: { dominion: true } } } });
  assert.equal(hasTag(doc, "dominion", DEFAULTS), true);
  doc.flags[ID] = { tags: { dominion: false } };
  assert.equal(hasTag(doc, "dominion", DEFAULTS), false);
});

test("legacy technological mark is readable, explicit false beats legacy and properties", () => {
  const doc = item({ flags: { world: { technologicalWeapon: true } } });
  assert.equal(hasTag(doc, "technological", DEFAULTS), true);
  doc.flags[ID] = { tags: { technological: false } };
  doc.system.properties.add("itags_technological");
  assert.equal(hasTag(doc, "technological", DEFAULTS), false);
});
test("disable and re-enable never erase the mark", () => {
  const doc = item({ flags: { [ID]: { tags: { technological: true } } } });
  const defs = structuredClone(DEFAULTS); defs[0].enabled = false;
  assert.equal(tagMap(doc, defs).technological, 0);
  assert.equal(rawTag(doc, "technological"), true);
  defs[0].enabled = true;
  assert.equal(tagMap(doc, defs).technological, 1);
  assert.equal(hasTag(doc, "technological", defs, false), false);
});
test("scope covers new Item types, filters actors and selected item types", () => {
  assert.equal(applicable(item({ type: "custom_device" }), DEFAULTS[0]), true);
  assert.equal(applicable({ documentName: "Actor" }, DEFAULTS[0]), false);
  assert.equal(applicable({ documentName: "Actor" }, DEFAULTS[3]), true);
  const def = { ...DEFAULTS[0], itemTypes: ["weapon", "spell"] };
  assert.equal(applicable(item({ type: "equipment" }), def), false);
});
test("flat and expanded flag writes mirror native properties and legacy", () => {
  for (const change of [{ [`flags.${ID}.tags.technological`]: true }, { flags: { [ID]: { tags: { technological: true } } } }]) {
    const patch = syncItemUpdate(item(), change, DEFAULTS);
    assert.deepEqual(patch["system.properties"], ["itags_technological"]);
    assert.equal(patch["flags.world.technologicalWeapon"], true);
  }
});
test("native edit preserves foreign properties and mirrors an uncheck", () => {
  const doc = item({ _source: { system: { properties: ["fin", "itags_technological", "external"] } } });
  const patch = syncItemUpdate(doc, { "system.properties": ["fin", "external"] }, DEFAULTS);
  assert.equal(patch[`flags.${ID}.tags.technological`], false);
  assert.equal(patch["flags.world.technologicalWeapon"], false);
  assert.deepEqual(patch["system.properties"], ["fin", "external"]);
});
test("disabled properties survive a native form that omits hidden choices", () => {
  const doc = item({ _source: { system: { properties: ["itags_technological"] } } });
  const defs = structuredClone(DEFAULTS); defs[0].enabled = false;
  const patch = syncItemUpdate(doc, { "system.properties": ["fin"] }, defs);
  assert.deepEqual(patch["system.properties"], ["fin", "itags_technological"]);
  assert.equal(patch[`flags.${ID}.tags.technological`], undefined);
});
test("unrelated edits do not persist prepared enchantment properties", () => {
  const doc = item({ system: { properties: new Set(["itags_technological"]) }, flags: { [ID]: { tags: { technological: true } } } });
  assert.deepEqual(syncItemUpdate(doc, { name: "Sword" }, DEFAULTS), {});
});
test("Items without properties only get flags", () => {
  const doc = item({ type: "class", system: {}, _source: { system: {} } });
  const patch = syncItemUpdate(doc, { [`flags.${ID}.tags.dominion`]: true }, DEFAULTS);
  assert.equal(patch["system.properties"], undefined);
  assert.equal(patch[`flags.${ID}.tags.dominion`], true);
});
test("old registry writes stay synchronized", () => {
  const patch = syncItemUpdate(item(), { "flags.world.technologicalWeapon": true }, DEFAULTS);
  assert.equal(patch[`flags.${ID}.tags.technological`], true);
});
test("copy source preserves independent tags; rename definition keeps the key", () => {
  const original = { type: "weapon", flags: { [ID]: { tags: { dominion: true } } } };
  const copy = structuredClone(original); copy.flags[ID].tags.dominion = false;
  assert.equal(rawTag(original, "dominion"), true);
  assert.equal(rawTag(copy, "dominion"), false);
  const renamed = structuredClone(DEFAULTS); renamed[1].label = "Доминионское";
  assert.equal(hasTag(original, "dominion", renamed), true);
});
test("keys reject duplicates, paths, prototype pollution and missing labels", () => {
  for (const key of ["__proto__", "constructor", "a.b", "a-b", "Техно", "1abc"]) {
    assert.throws(() => validateDefinitions([{ ...DEFAULTS[0], key }]));
  }
  assert.throws(() => validateDefinitions([DEFAULTS[0], DEFAULTS[0]]));
  assert.throws(() => validateDefinitions([{ ...DEFAULTS[0], label: " " }]));
  assert.deepEqual(validateDefinitions(DEFAULTS), DEFAULTS);
});
