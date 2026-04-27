import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  analyzeStations,
  calculateBreakEvenLiters,
  calculateStationMetrics
} from "../public/lib/fuel-analysis.js";

const settings = {
  ...DEFAULT_SETTINGS,
  litersToBuy: 30
};

const nearby = calculateStationMetrics(
  {
    id: "1",
    brand: "Cercana",
    address: "Centro 1",
    locality: "Murcia",
    province: "Murcia",
    lat: 38.016,
    lon: -1.1536,
    price: 1.459
  },
  settings,
  2.4,
  4,
  "road"
);

const cheaperFar = calculateStationMetrics(
  {
    id: "2",
    brand: "Barata Lejana",
    address: "Salida 41",
    locality: "Mula",
    province: "Murcia",
    lat: 38.27,
    lon: -1.24,
    price: 1.369
  },
  settings,
  43.5,
  37,
  "road"
);

test("la mas barata en surtidor puede no ser la mejor opcion real", () => {
  const analysis = analyzeStations([nearby, cheaperFar]);

  assert.equal(analysis.cheapestByPump?.brand, "Barata Lejana");
  assert.equal(analysis.bestByEffectiveCost?.brand, "Cercana");
  assert.ok((analysis.breakEvenLiters || 0) > settings.litersToBuy);
});

test("el punto de equilibrio es positivo cuando hay ahorro por litro", () => {
  const liters = calculateBreakEvenLiters(cheaperFar, nearby);

  assert.ok(liters !== null);
  assert.ok(liters > 0);
});
