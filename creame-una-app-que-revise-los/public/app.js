import {
  DEFAULT_ORIGIN,
  DEFAULT_SETTINGS,
  PRODUCTS,
  ROAD_DISTANCE_FALLBACK_FACTOR,
  analyzeStations,
  buildFallbackRoadDistanceKm,
  calculateStationMetrics,
  formatCoordinates,
  formatCurrency,
  formatDistance,
  formatDuration,
  getStationPrice,
  haversineKm
} from "./lib/fuel-analysis.js";

const DATASET_REFRESH_MS = 30 * 60 * 1000;
const MAX_ROUTE_BATCH = 80;
const OSRM_BASE_URL = "https://router.project-osrm.org";

const form = document.querySelector("#settings-form");
const productSelect = document.querySelector("#product-select");
const refreshButton = document.querySelector("#refresh-button");
const resetMapButton = document.querySelector("#reset-map-button");
const sourceIndicator = document.querySelector("#source-indicator");
const refreshNote = document.querySelector("#refresh-note");
const statusBanner = document.querySelector("#status-banner");
const updatedAt = document.querySelector("#updated-at");
const originLabel = document.querySelector("#origin-label");
const stationsBody = document.querySelector("#stations-body");
const bestRealName = document.querySelector("#best-real-name");
const bestRealDetail = document.querySelector("#best-real-detail");
const cheapestName = document.querySelector("#cheapest-name");
const cheapestDetail = document.querySelector("#cheapest-detail");
const breakevenValue = document.querySelector("#breakeven-value");
const breakevenDetail = document.querySelector("#breakeven-detail");
const routeModeValue = document.querySelector("#route-mode-value");
const routeModeDetail = document.querySelector("#route-mode-detail");
const insightText = document.querySelector("#insight-text");

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  dataset: null,
  analysis: null,
  loading: false,
  datasetRefreshId: null,
  analysisRequestId: 0,
  map: null,
  originMarker: null,
  radiusCircle: null,
  stationLayer: null
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setLoading(message) {
  stationsBody.innerHTML = `<tr><td colspan="8" class="empty-row">${message}</td></tr>`;
}

function setStatus(message = "") {
  if (!message) {
    statusBanner.hidden = true;
    statusBanner.textContent = "";
    return;
  }

  statusBanner.hidden = false;
  statusBanner.textContent = message;
}

function datasetUrl({ cacheBust = false } = {}) {
  const url = new URL("./data/stations.es.json", window.location.href);

  if (cacheBust) {
    url.searchParams.set("t", String(Date.now()));
  }

  return url.toString();
}

function populateProducts() {
  productSelect.innerHTML = PRODUCTS.map(
    (product) => `<option value="${product.id}">${product.label}</option>`
  ).join("");
}

function renderFormFromState() {
  form.elements.productId.value = state.settings.productId;
  form.elements.litersToBuy.value = String(state.settings.litersToBuy);
  form.elements.consumptionLitersPer100Km.value = String(
    state.settings.consumptionLitersPer100Km
  );
  form.elements.radiusKm.value = String(state.settings.radiusKm);
  form.elements.roundTrip.checked = state.settings.roundTrip;
}

function readSettingsFromForm() {
  state.settings = {
    ...state.settings,
    productId: form.elements.productId.value,
    litersToBuy: Math.max(Number(form.elements.litersToBuy.value) || 1, 1),
    consumptionLitersPer100Km: Math.max(
      Number(form.elements.consumptionLitersPer100Km.value) || 0.1,
      0.1
    ),
    radiusKm: Math.max(Number(form.elements.radiusKm.value) || 1, 1),
    roundTrip: form.elements.roundTrip.checked
  };
}

function updateOrigin(origin) {
  state.settings.origin = {
    latitude: origin.latitude,
    longitude: origin.longitude,
    label: origin.label || "Ubicacion elegida"
  };

  originLabel.textContent = `${state.settings.origin.label} - ${formatCoordinates(
    state.settings.origin
  )}`;

  if (state.originMarker) {
    state.originMarker.setLatLng([origin.latitude, origin.longitude]);
  }

  if (state.radiusCircle) {
    state.radiusCircle.setLatLng([origin.latitude, origin.longitude]);
    state.radiusCircle.setRadius(state.settings.radiusKm * 1000);
  }
}

function resetSummary() {
  bestRealName.textContent = "-";
  bestRealDetail.textContent = "-";
  cheapestName.textContent = "-";
  cheapestDetail.textContent = "-";
  breakevenValue.textContent = "-";
  breakevenDetail.textContent = "-";
  routeModeValue.textContent = "-";
  routeModeDetail.textContent = "-";
  insightText.textContent = "Selecciona un punto en el mapa para calcular el mejor repostaje.";
}

function initMap() {
  if (!window.L) {
    setStatus("No se ha podido cargar el mapa.");
    return;
  }

  state.map = window.L.map("map", {
    zoomControl: true
  }).setView([40.2, -3.7], 6);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(state.map);

  state.stationLayer = window.L.layerGroup().addTo(state.map);

  state.originMarker = window.L.marker(
    [DEFAULT_ORIGIN.latitude, DEFAULT_ORIGIN.longitude],
    { draggable: true }
  ).addTo(state.map);

  state.radiusCircle = window.L.circle(
    [DEFAULT_ORIGIN.latitude, DEFAULT_ORIGIN.longitude],
    {
      radius: DEFAULT_SETTINGS.radiusKm * 1000,
      color: "#0d7a66",
      weight: 2,
      fillColor: "#0d7a66",
      fillOpacity: 0.08
    }
  ).addTo(state.map);

  state.map.on("click", (event) => {
    updateOrigin({
      latitude: event.latlng.lat,
      longitude: event.latlng.lng,
      label: "Punto en mapa"
    });
    void runAnalysis();
  });

  state.originMarker.on("dragend", () => {
    const position = state.originMarker.getLatLng();
    updateOrigin({
      latitude: position.lat,
      longitude: position.lng,
      label: "Punto arrastrado"
    });
    void runAnalysis();
  });

  updateOrigin({
    latitude: DEFAULT_ORIGIN.latitude,
    longitude: DEFAULT_ORIGIN.longitude,
    label: DEFAULT_ORIGIN.name
  });
}

async function requestJson(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudo cargar la informacion.");
    }

    return payload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchRouteChunk(origin, stations) {
  const coordinates = [
    `${origin.longitude},${origin.latitude}`,
    ...stations.map((station) => `${station.lon},${station.lat}`)
  ].join(";");

  const url = `${OSRM_BASE_URL}/table/v1/driving/${coordinates}?sources=0&annotations=distance,duration`;
  const payload = await requestJson(url, 30000);

  if (payload.code !== "Ok") {
    throw new Error("El motor de rutas no ha devuelto una respuesta util.");
  }

  const distances = payload.distances?.[0]?.slice(1) || [];
  const durations = payload.durations?.[0]?.slice(1) || [];

  return stations.map((station, index) => ({
    id: station.id,
    routeDistanceKm: Number.isFinite(distances[index]) ? distances[index] / 1000 : null,
    routeDurationMin: Number.isFinite(durations[index]) ? durations[index] / 60 : null
  }));
}

async function fetchRoadMetrics(origin, stations) {
  const metrics = new Map();

  for (let index = 0; index < stations.length; index += MAX_ROUTE_BATCH) {
    const chunk = stations.slice(index, index + MAX_ROUTE_BATCH);
    const chunkMetrics = await fetchRouteChunk(origin, chunk);

    for (const metric of chunkMetrics) {
      metrics.set(metric.id, metric);
    }
  }

  return metrics;
}

function scheduleDatasetRefresh() {
  if (state.datasetRefreshId) {
    window.clearInterval(state.datasetRefreshId);
  }

  state.datasetRefreshId = window.setInterval(() => {
    void loadDataset({ silent: true });
  }, DATASET_REFRESH_MS);
}

async function loadDataset({ silent = false } = {}) {
  const previousDataset = state.dataset;

  if (!silent) {
    setStatus("");
    setLoading("Cargando dataset...");
  }

  try {
    state.dataset = await requestJson(datasetUrl({ cacheBust: true }));
    scheduleDatasetRefresh();
    await runAnalysis();
  } catch (error) {
    state.dataset = previousDataset;

    if (!previousDataset) {
      resetSummary();
      setLoading("No he podido leer el dataset local.");
    } else {
      await runAnalysis();
    }

    setStatus(error instanceof Error ? error.message : "No se ha podido cargar el dataset.");
  }
}

function buildFallbackMetrics(stations) {
  return new Map(
    stations.map((station) => [
      station.id,
      {
        id: station.id,
        routeDistanceKm: buildFallbackRoadDistanceKm(state.settings.origin, station),
        routeDurationMin: null
      }
    ])
  );
}

function routeModeSummary(stations) {
  const fallbackCount = stations.filter((station) => station.routeMode === "fallback").length;

  if (stations.length === 0) {
    return {
      value: "-",
      detail: "Sin estaciones en el radio"
    };
  }

  if (fallbackCount === 0) {
    return {
      value: "Carretera real",
      detail: `${stations.length} estaciones calculadas con rutas reales`
    };
  }

  if (fallbackCount === stations.length) {
    return {
      value: "Aproximacion fija",
      detail: `Factor interno ${ROAD_DISTANCE_FALLBACK_FACTOR.toFixed(2)}x por fallo del motor de rutas`
    };
  }

  return {
    value: "Mixto",
    detail: `${stations.length - fallbackCount} con ruta real, ${fallbackCount} con aproximacion fija`
  };
}

function buildInsight(analysis) {
  const { bestByEffectiveCost, cheapestByPump, breakEvenLiters } = analysis;

  if (!bestByEffectiveCost || !cheapestByPump) {
    return "No hay estaciones validas dentro del radio indicado.";
  }

  if (bestByEffectiveCost.id === cheapestByPump.id) {
    return `${bestByEffectiveCost.brand} coincide como la mas barata y la que mas compensa para ${state.settings.litersToBuy} L netos.`;
  }

  const savings = cheapestByPump.effectiveTotalCost - bestByEffectiveCost.effectiveTotalCost;

  if (breakEvenLiters !== null && breakEvenLiters > state.settings.litersToBuy) {
    return `La mas barata del surtidor es ${cheapestByPump.brand}, pero con ${state.settings.litersToBuy} L compensa mas ${bestByEffectiveCost.brand}. El ahorro real frente al viaje a la mas barata es ${formatCurrency(savings)}.`;
  }

  return `${bestByEffectiveCost.brand} gana por coste total efectivo. ${cheapestByPump.brand} solo vence por precio del surtidor.`;
}

function renderTable(analysis) {
  if (analysis.stations.length === 0) {
    stationsBody.innerHTML =
      '<tr><td colspan="8" class="empty-row">No hay estaciones dentro del radio indicado.</td></tr>';
    return;
  }

  stationsBody.innerHTML = analysis.stations
    .slice(0, 30)
    .map((station, index) => {
      const isBest = station.id === analysis.bestByEffectiveCost?.id;
      const isCheapest = station.id === analysis.cheapestByPump?.id;

      return `
        <tr>
          <td>${index + 1}</td>
          <td class="station-cell">
            <strong>${escapeHtml(station.brand)}</strong>
            <span>${escapeHtml(station.address)}</span>
            <span>${escapeHtml(station.locality)} - ${escapeHtml(station.province)}</span>
            <div class="tag-row">
              ${isBest ? '<span class="tag">Mejor opcion</span>' : ""}
              ${isCheapest ? '<span class="tag">Mas barata</span>' : ""}
            </div>
          </td>
          <td>${formatCurrency(station.price)}/L</td>
          <td>
            <strong>${formatDistance(station.routeDistanceKm)}</strong>
            <span>Linea recta ${formatDistance(station.directDistanceKm)}</span>
          </td>
          <td>${station.tripDurationMin !== null ? formatDuration(station.tripDurationMin) : "-"}</td>
          <td>${station.travelFuelLiters.toFixed(2).replace(".", ",")} L</td>
          <td>${formatCurrency(station.effectiveTotalCost)}</td>
          <td>${formatCurrency(station.effectivePricePerNetLiter)}/L</td>
        </tr>
      `;
    })
    .join("");
}

function renderMapMarkers(analysis) {
  if (!state.stationLayer) {
    return;
  }

  state.stationLayer.clearLayers();

  const topStations = analysis.stations.slice(0, 12);

  for (const station of topStations) {
    const isBest = station.id === analysis.bestByEffectiveCost?.id;
    const isCheapest = station.id === analysis.cheapestByPump?.id;
    const color = isBest ? "#0d7a66" : isCheapest ? "#c05a17" : "#355c7d";

    const marker = window.L.circleMarker([station.lat, station.lon], {
      radius: isBest || isCheapest ? 8 : 6,
      weight: 2,
      color,
      fillColor: color,
      fillOpacity: 0.85
    });

    marker.bindPopup(
      `
        <strong>${escapeHtml(station.brand)}</strong><br />
        ${escapeHtml(station.address)}<br />
        ${escapeHtml(station.locality)} - ${escapeHtml(station.province)}<br />
        Precio: ${formatCurrency(station.price)}/L<br />
        Distancia: ${formatDistance(station.routeDistanceKm)}<br />
        Coste real: ${formatCurrency(station.effectiveTotalCost)}
      `
    );

    marker.addTo(state.stationLayer);
  }
}

function renderSummary(analysis) {
  const routeSummary = routeModeSummary(analysis.stations);

  routeModeValue.textContent = routeSummary.value;
  routeModeDetail.textContent = routeSummary.detail;

  if (!analysis.bestByEffectiveCost || !analysis.cheapestByPump) {
    bestRealName.textContent = "-";
    bestRealDetail.textContent = "Sin estaciones validas";
    cheapestName.textContent = "-";
    cheapestDetail.textContent = "Sin estaciones validas";
    breakevenValue.textContent = "-";
    breakevenDetail.textContent = "No disponible";
    insightText.textContent =
      "No hay estaciones con el combustible seleccionado dentro del radio indicado.";
    routeModeValue.textContent = routeSummary.value;
    routeModeDetail.textContent = routeSummary.detail;
    return;
  }

  bestRealName.textContent = analysis.bestByEffectiveCost.brand;
  bestRealDetail.textContent = `${formatCurrency(analysis.bestByEffectiveCost.price)}/L - coste real ${formatCurrency(analysis.bestByEffectiveCost.effectiveTotalCost)}`;

  cheapestName.textContent = analysis.cheapestByPump.brand;
  cheapestDetail.textContent = `${formatCurrency(analysis.cheapestByPump.price)}/L - ${formatDistance(analysis.cheapestByPump.routeDistanceKm)}`;

  if (analysis.bestByEffectiveCost.id === analysis.cheapestByPump.id) {
    breakevenValue.textContent = "Coinciden";
    breakevenDetail.textContent = "La misma estacion gana por precio y por coste real.";
  } else if (analysis.breakEvenLiters !== null) {
    breakevenValue.textContent = `${analysis.breakEvenLiters.toFixed(1).replace(".", ",")} L`;
    breakevenDetail.textContent = "A partir de ese volumen neto compensa ir a la mas barata.";
  } else {
    breakevenValue.textContent = "No aplica";
    breakevenDetail.textContent = "No se ha podido estimar un punto de equilibrio util.";
  }

  insightText.textContent = buildInsight(analysis);
}

function renderMeta() {
  if (!state.dataset) {
    sourceIndicator.textContent = "Dataset no disponible.";
    refreshNote.textContent = "Sin datos cargados.";
    updatedAt.textContent = "No disponible";
    return;
  }

  const totalStations = state.dataset.stationCount || state.dataset.stations?.length || 0;
  const sourceLabel =
    state.dataset.source === "official"
      ? "Dataset oficial del ministerio"
      : "Dataset de ejemplo";

  sourceIndicator.textContent = `${sourceLabel}. ${totalStations} estaciones con diesel en el fichero actual.`;
  refreshNote.textContent =
    "La pagina vuelve a leer el dataset cada 30 minutos. En GitHub Pages el workflow tambien lo regenera cada 30 minutos.";
  updatedAt.textContent = state.dataset.sourceUpdatedAt || state.dataset.generatedAt || "Sin fecha";
}

async function runAnalysis() {
  readSettingsFromForm();

  if (!state.dataset || !Array.isArray(state.dataset.stations)) {
    resetSummary();
    renderMeta();
    return;
  }

  const requestId = ++state.analysisRequestId;
  state.loading = true;
  setLoading("Calculando rutas y coste real...");

  try {
    const pricedCandidates = state.dataset.stations
      .map((station) => ({
        ...station,
        directDistanceKm: haversineKm(state.settings.origin, station),
        price: getStationPrice(station, state.settings.productId)
      }))
      .filter((station) => station.price !== null)
      .filter((station) => station.directDistanceKm <= state.settings.radiusKm);

    let routeMetrics;
    let routeFallbackMessage = "";

    try {
      routeMetrics = await fetchRoadMetrics(state.settings.origin, pricedCandidates);
    } catch {
      routeMetrics = buildFallbackMetrics(pricedCandidates);
      routeFallbackMessage = `El motor de rutas no ha respondido. Se usa una aproximacion fija ${ROAD_DISTANCE_FALLBACK_FACTOR.toFixed(2)}x sobre la linea recta.`;
    }

    if (requestId !== state.analysisRequestId) {
      return;
    }

    const calculatedStations = pricedCandidates
      .map((station) => {
        const routeMetric = routeMetrics.get(station.id);
        const routeDistanceKm =
          routeMetric?.routeDistanceKm ?? buildFallbackRoadDistanceKm(state.settings.origin, station);
        const routeDurationMin = routeMetric?.routeDurationMin ?? null;
        const routeMode = routeMetric?.routeDistanceKm ? "road" : "fallback";

        return calculateStationMetrics(
          station,
          state.settings,
          routeDistanceKm,
          routeDurationMin,
          routeMode
        );
      })
      .filter((station) => station.routeDistanceKm <= state.settings.radiusKm);

    state.analysis = analyzeStations(calculatedStations);
    renderMeta();
    renderSummary(state.analysis);
    renderTable(state.analysis);
    renderMapMarkers(state.analysis);
    setStatus(routeFallbackMessage);
    state.radiusCircle?.setRadius(state.settings.radiusKm * 1000);
  } finally {
    state.loading = false;
  }
}

populateProducts();
renderFormFromState();
initMap();
resetSummary();
renderMeta();

form.addEventListener("input", () => {
  void runAnalysis();
});

refreshButton.addEventListener("click", () => {
  void loadDataset();
});

resetMapButton.addEventListener("click", () => {
  state.map?.setView([40.2, -3.7], 6);
});

window.addEventListener("beforeunload", () => {
  if (state.datasetRefreshId) {
    window.clearInterval(state.datasetRefreshId);
  }
});

void loadDataset();
