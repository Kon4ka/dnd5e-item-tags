import { ID, applicable, hasTag, rawTag, tagMap, flagPath, propertyKey } from "./model.mjs";

export const definitions = () => game.settings.get(ID, "definitions");
export const enabled = () => game.settings.get(ID, "enabled");
export const has = (doc, key) => hasTag(doc, key, definitions(), enabled());
export const all = (doc, keys) => keys.length > 0 && keys.every(key => has(doc, key));
export const any = (doc, keys) => keys.some(key => has(doc, key));
export const activeEffect = effect => !effect.disabled && !effect.isSuppressed && effect.active !== false;
export function actorHas(actor, key) {
  if (!actor) return false;
  // Prepared Actor flags include effects changing flags.dnd5e-item-tags.tags.*.
  // Effect metadata can also classify an Actor, but inventory contents never do so implicitly.
  return has(actor, key) || Array.from(actor.appliedEffects ?? []).some(e => activeEffect(e) && has(e, key));
}
export const map = doc => tagMap(doc, definitions(), enabled());
export const actorMap = actor => Object.fromEntries(definitions().map(d => [d.key, actorHas(actor, d.key) ? 1 : 0]));
export function canEdit(doc) {
  return !!doc?.isOwner && (game.user.isGM || !game.settings.get(ID, "gmOnly"))
    && !(doc.pack && game.packs.get(doc.pack)?.locked);
}
export async function set(doc, key, value) {
  const def = definitions().find(d => d.key === key);
  if (!canEdit(doc)) throw new Error("Нет права редактировать теги этого документа.");
  if (!def || !applicable(doc, def)) throw new Error(`Тег «${key}» недоступен для этого документа.`);
  if (!enabled() || !def.enabled) throw new Error("Тег выключен в настройках мира.");
  return doc.update({ [flagPath(key)]: value === true });
}
/** Resolve provenance explicitly; never infer Empire protection from its actor's faction. */
export async function sourceHas(effect, key) {
  if (has(effect, key)) return true;
  const uuid = effect?.origin;
  if (!uuid) return false;
  try {
    const origin = await fromUuid(uuid);
    const item = origin?.documentName === "Item" ? origin : origin?.item;
    return item ? has(item, key) : false;
  } catch { return false; }
}
export const api = { has, all, any, actorHas, sourceHas, set, map, actorMap, raw: rawTag,
  definitions: () => structuredClone(definitions()), flagPath, propertyKey };
