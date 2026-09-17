// Pure data logic, deliberately independent of Foundry and Midi.
export const ID = "dnd5e-item-tags";
export const PREFIX = "itags_";
export const DEFAULTS = [
  { key: "technological", label: "Технологическое", enabled: true, itemTypes: ["*"], actors: false, effects: true },
  { key: "dominion", label: "Доминион", enabled: true, itemTypes: ["*"], actors: true, effects: true },
  { key: "empire", label: "Империя", enabled: true, itemTypes: ["*"], actors: true, effects: true },
  { key: "magic_user", label: "Использует магию", enabled: true, itemTypes: [], actors: true, effects: true }
];
export const truth = value => value === true || value === 1 || value === "true" || value === "1";
export const propertyKey = key => `${PREFIX}${key}`;
export const flagPath = key => `flags.${ID}.tags.${key}`;
export const list = value => value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
export const get = (object, path) => {
  if (Object.hasOwn(object ?? {}, path)) return object[path];
  return path.split(".").reduce((value, part) => value?.[part], object);
};
export function validateDefinitions(input) {
  if (!Array.isArray(input) || input.length > 200) throw new Error("Нужен список не более 200 тегов.");
  const keys = new Set();
  return input.map(row => {
    const key = String(row.key ?? "").trim();
    const label = String(row.label ?? "").trim();
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key) || ["constructor", "prototype", "__proto__"].includes(key)) {
      throw new Error(`Ключ «${key}»: латинские строчные буквы, цифры и _, первая буква; до 48 символов.`);
    }
    if (keys.has(key)) throw new Error(`Повторяется ключ «${key}».`);
    if (!label || label.length > 100) throw new Error(`Название «${key}» должно содержать от 1 до 100 символов.`);
    keys.add(key);
    return { key, label, enabled: row.enabled === true, itemTypes: [...new Set(list(row.itemTypes).map(String))],
      actors: row.actors === true, effects: row.effects === true };
  });
}
export function applicable(doc, def) {
  const kind = doc?.documentName;
  if (kind === "Actor") return def.actors;
  if (kind === "ActiveEffect") return def.effects;
  return (kind === "Item" || (!kind && doc?.type)) && (def.itemTypes.includes("*") || def.itemTypes.includes(doc.type));
}
export function rawTag(doc, key, { source = false } = {}) {
  const data = source ? (doc?._source ?? doc) : doc;
  const explicit = data?.flags?.[ID]?.tags?.[key] ?? data?.flags?.["intermezzo-tags"]?.tags?.[key];
  // Explicit false also suppresses an old flag or a property mirrored before an enchantment.
  if (explicit !== undefined) return truth(explicit);
  if (key === "technological" && data?.flags?.world?.technologicalWeapon !== undefined) {
    return truth(data.flags.world.technologicalWeapon);
  }
  return list(data?.system?.properties).includes(propertyKey(key));
}
export function hasTag(doc, key, definitions, enabled = true) {
  const def = definitions.find(d => d.key === key);
  return !!(enabled && def?.enabled && applicable(doc, def) && rawTag(doc, key));
}
export function tagMap(doc, definitions, enabled = true) {
  return Object.fromEntries(definitions.map(def => [def.key, hasTag(doc, def.key, definitions, enabled) ? 1 : 0]));
}

/** Patch only changed flags/properties. Never copy prepared (enchanted) values into source data. */
export function syncItemUpdate(doc, change, definitions, { native = true, enabled = true } = {}) {
  const patch = {};
  const oldProps = list(doc._source?.system?.properties ?? doc.system?.properties);
  const submitted = get(change, "system.properties");
  const propertyEdit = Array.isArray(submitted) || submitted instanceof Set;
  const props = new Set(propertyEdit ? list(submitted) : oldProps);
  const supportsProperties = doc.system?.properties !== undefined;
  let propertiesChanged = false;
  for (const def of definitions) {
    const path = flagPath(def.key);
    const flagValue = get(change, path);
    const legacyValue = def.key === "technological" ? get(change, "flags.world.technologicalWeapon") : undefined;
    const pk = propertyKey(def.key);
    const available = enabled && def.enabled && applicable(doc, def);
    let value;
    if (flagValue !== undefined) value = truth(flagValue);
    else if (legacyValue !== undefined) value = truth(legacyValue);
    else if (native && available && propertyEdit && props.has(pk) !== oldProps.includes(pk)) value = props.has(pk);
    // Hidden/disabled properties must survive unrelated native form submissions.
    if (native && propertyEdit && !available && oldProps.includes(pk) && !props.has(pk)) {
      props.add(pk); propertiesChanged = true;
    }
    if (value === undefined) continue;
    patch[path] = value;
    if (def.key === "technological") patch["flags.world.technologicalWeapon"] = value;
    if (native && supportsProperties) {
      if (value) props.add(pk); else props.delete(pk);
      propertiesChanged = true;
    }
  }
  if (propertiesChanged) patch["system.properties"] = [...props];
  return patch;
}
