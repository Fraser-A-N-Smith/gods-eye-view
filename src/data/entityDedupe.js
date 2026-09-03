/**
 * @module data/entityDedupe
 * @description Shared guard against Cesium's duplicate-id throw.
 *
 * `EntityCollection.add` throws SYNCHRONOUSLY when an id already exists in
 * the collection. Six timer-driven layers (globalHazards, volcanoes,
 * oceanBuoys, hamRadioPropagation, borderWaitTimes, fireballs) all do
 * `entities.removeAll()` then loop `entities.add({ id, ... })` per upstream
 * record. `removeAll()` clears the collection first, so the throw can only
 * come from TWO records in the SAME payload computing the same id — but
 * upstream feeds do produce that: `episodeid` is dropped from the GDACS id
 * (`gdacs:${eventtype}:${eventid}`), so two episodes of one event collide;
 * CBP has repeated a `port_number`; ham-radio has repeated a report.
 *
 * That throw propagates out of the loop into the layer's own broad
 * `catch (e)` around `update()`, which reports a generic `'<Layer> network
 * error'` — a data-quality problem misreported as a connectivity one — and
 * leaves `entities` (and `_count`/`_lastUpdate`) holding whatever partial
 * set was added before the throw, or the STALE previous set if the throw
 * happened before anything new was added that pass.
 *
 * `addUniqueEntity` replaces the direct `entities.add(...)` call: given a
 * `Set` the caller owns for the duration of one `update()` pass, it skips
 * (rather than throws on) an id already added this pass, so one bad record
 * degrades to "one fewer pin" instead of "the whole refresh silently keeps
 * last update's data forever behind a fake network error".
 */

/**
 * Add an entity, skipping it if its id was already added earlier in this
 * same pass rather than letting Cesium throw.
 *
 * @param {{add: Function}} entities A Cesium `EntityCollection`
 *   (`dataSource.entities`) or anything else exposing Cesium's `add(options)`
 *   contract.
 * @param {Set<string>} seenIds Ids already added this pass. Callers create a
 *   fresh `Set` right after `entities.removeAll()` and reuse it for the
 *   whole loop; passing the same `Set` across multiple `update()` calls
 *   would treat every pass as a continuation of the last and wrongly skip
 *   ids that are only stale by having been removed.
 * @param {object} options Cesium `Entity` constructor options. `options.id`
 *   is required — an entity with no id can never collide, but it also can't
 *   be deduplicated, so it is rejected here rather than silently added
 *   un-tracked.
 * @returns {boolean} `true` if the entity was added, `false` if it was
 *   skipped as a duplicate (or had no id to dedupe against).
 */
export function addUniqueEntity(entities, seenIds, options) {
  const id = options?.id;
  if (id == null) return false;
  if (seenIds.has(id)) return false;
  seenIds.add(id);
  entities.add(options);
  return true;
}
