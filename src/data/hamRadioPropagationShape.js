/**
 * @module data/hamRadioPropagationShape
 * @description Maidenhead grid-square decoder and PSKReporter reception-report
 * XML parser.
 *
 * Pure module shared by the `/api/ham-radio` proxy (vite.config.js, Node-only)
 * and the Cesium-importing layer (hamRadioPropagation.js, browser-only) —
 * mirroring the existing `spaceWeatherShape.js` / `globalHazardsShape.js` /
 * `volcanoesShape.js` / `oceanBuoysShape.js` precedent so the server and the
 * client run the SAME parsing implementation instead of two copies that can
 * drift apart.
 *
 * PSKReporter's upstream (`retrieve.pskreporter.info/query`) is XML, not
 * JSON, and station locations are given as Maidenhead grid squares (e.g.
 * "JO33ki90"), not lat/lon — both quirks are handled here, once, so neither
 * the proxy nor the browser layer parses raw XML or decodes a grid square a
 * second time.
 *
 * PSKReporter's developer page explicitly asks for no more than one poll
 * every 5 minutes. This module has no polling logic of its own to enforce
 * that — it is enforced jointly by the client layer's
 * `updateInterval: 300000` (hamRadioPropagation.js) and the proxy's cache
 * `TTL_MS = 5 * 60 * 1000` (vite.config.js) — but it is worth calling out
 * here as the shared contract those two settings jointly satisfy.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/** 4, 6, or 8-character Maidenhead grid locator grammar. */
const MAIDENHEAD_RE = /^[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2})?([0-9]{2})?$/;

/** Hard cap on parsed reception reports — matches the `rptlimit=200` request
 * parameter (belt-and-suspenders; the upstream should already honor it). */
const MAX_RECORDS = 200;

/**
 * Decode a Maidenhead grid locator (field = 20°lon × 10°lat, square = 2°lon
 * × 1°lat, subsquare = 5′lon × 2.5′lat) into the lat/lon **center** of the
 * smallest resolved cell. Returns null for any input that is not a
 * syntactically valid locator — never throws.
 *
 * An 8-character locator's trailing extended-square digits are accepted by
 * the grammar (so an 8-char locator is never rejected as invalid) but are
 * intentionally NOT decoded to any finer precision than the 6-char
 * subsquare — this decoder resolves no further than subsquare, so an
 * 8-char locator returns the exact same center as its 6-char prefix.
 * @param {string} locator
 * @returns {{lat: number, lon: number}|null}
 */
export function maidenheadToLatLon(locator) {
  if (typeof locator !== 'string' || !MAIDENHEAD_RE.test(locator.trim())) return null;
  const loc = locator.trim().toUpperCase();
  const A = 'A'.charCodeAt(0);
  let lon = (loc.charCodeAt(0) - A) * 20 - 180;
  let lat = (loc.charCodeAt(1) - A) * 10 - 90;
  lon += Number(loc[2]) * 2;
  lat += Number(loc[3]) * 1;
  let lonRes = 2;
  let latRes = 1;
  if (loc.length >= 6) {
    lon += (loc.charCodeAt(4) - A) * (2 / 24);
    lat += (loc.charCodeAt(5) - A) * (1 / 24);
    lonRes = 2 / 24;
    latRes = 1 / 24;
  }
  return { lat: lat + latRes / 2, lon: lon + lonRes / 2 };
}

/** Match one self-closing `<receptionReport .../>` tag and capture its attributes. */
const REPORT_TAG_RE = /<receptionReport\b([^>]*)\/?>/g;

/** Read one double-quoted XML attribute value out of a captured attribute blob. */
function attr(attrsText, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrsText);
  return match ? match[1] : null;
}

/**
 * Parse a PSKReporter `receptionReports` XML payload into normalized spot
 * records. There is no DOM parser available in the Node proxy context, so
 * this hand-rolls a minimal attribute extractor over each self-closing
 * `<receptionReport .../>` tag (mirroring the house style of `firmsCsv.js`'s
 * hand-rolled CSV parsing — no heavy XML-parsing dependency for a handful of
 * known attributes).
 *
 * Both the sender's and the receiver's Maidenhead locator are decoded via
 * {@link maidenheadToLatLon}; a record is DROPPED (not partially kept) if
 * either locator fails to decode, since a one-sided arc has nowhere to draw
 * its other end. Capped at {@link MAX_RECORDS}.
 *
 * The synthesized `id` includes `frequency` alongside sender/receiver
 * callsign and `flowStartSeconds`: FT8's 15-second decode windows are
 * globally time-synchronized across bands, and this query has no band
 * filter, so the SAME sender/receiver pair decoded simultaneously on two
 * bands is a real, common case that would otherwise collide on one id.
 *
 * @param {string} xmlText - Raw upstream XML response body.
 * @returns {Array<{id: string, senderCallsign: string|null,
 *   receiverCallsign: string|null, senderLat: number, senderLon: number,
 *   receiverLat: number, receiverLon: number, frequencyHz: number|null,
 *   mode: string|null, snr: number|null, flowStartSeconds: number|null}>}
 */
export function parsePskReporterXml(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText) return [];
  const spots = [];
  REPORT_TAG_RE.lastIndex = 0;
  let match;
  while ((match = REPORT_TAG_RE.exec(xmlText)) !== null) {
    if (spots.length >= MAX_RECORDS) break;
    const attrsText = match[1];
    const senderCallsign = textOrNull(attr(attrsText, 'senderCallsign'));
    const receiverCallsign = textOrNull(attr(attrsText, 'receiverCallsign'));
    const senderPos = maidenheadToLatLon(attr(attrsText, 'senderLocator'));
    const receiverPos = maidenheadToLatLon(attr(attrsText, 'receiverLocator'));
    if (!senderPos || !receiverPos) continue; // one-sided arc — drop it

    const flowStartSeconds = finiteOrNull(attr(attrsText, 'flowStartSeconds'));
    const frequencyHz = finiteOrNull(attr(attrsText, 'frequency'));
    spots.push({
      // Includes frequencyHz — see the doc comment above for why sender +
      // receiver + flowStartSeconds alone is not unique enough.
      id: `${senderCallsign || '?'}-${receiverCallsign || '?'}-${flowStartSeconds ?? spots.length}-${frequencyHz ?? '?'}`,
      senderCallsign,
      receiverCallsign,
      senderLat: senderPos.lat,
      senderLon: senderPos.lon,
      receiverLat: receiverPos.lat,
      receiverLon: receiverPos.lon,
      frequencyHz,
      mode: textOrNull(attr(attrsText, 'mode')),
      snr: finiteOrNull(attr(attrsText, 'sNR')),
      flowStartSeconds,
    });
  }
  return spots;
}
