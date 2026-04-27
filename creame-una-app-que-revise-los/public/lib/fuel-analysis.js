export const DEFAULT_ORIGIN = {
  name: "Espinardo",
  latitude: 38.010346,
  longitude: -1.153643
};

export const ROAD_DISTANCE_FALLBACK_FACTOR = 1.22;

export const PRODUCTS = [
  { id: "4", label: "Gasoleo A" },
  { id: "5", label: "Gasoleo Premium" },
  { id: "27", label: "Diesel renovable" }
];

export const DEFAULT_SETTINGS = {
  consumptionLitersPer100Km: 7.8,
  litersToBuy: 40,
  productId: "4",
  radiusKm: 50,
  roundTrip: true,
  origin: {
    latitude: DEFAULT_ORIGIN.latitude,
    longitude: DEFAULT_ORIGIN.longitude,
    label: DEFAULT_ORIGIN.name
  }
};

const euroFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const decimalFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

function latitudeOf(point) {
  return point.latitude ?? point.lat;
}

function longitudeOf(point) {
  return point.longitude ?? point.lon;
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value).trim().replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getStationPrice(station, productId) {
  if (station.price !== undefined && station.price !== null) {
    return parseNumber(station.price);
  }

  return parseNumber(station.prices?.[productId]);
}

export function formatCurrency(value) {
  return euroFormatter.format(value);
}

export function formatDistance(value) {
  return `${decimalFormatter.format(value)} km`;
}

export function formatDuration(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (value < 60) {
    return `${Math.round(value)} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return `${hours} h ${minutes} min`;
}

export function formatCoordinates(point) {
  return `${latitudeOf(point).toFixed(4)}, ${longitudeOf(point).toFixed(4)}`;
}

export function haversineKm(origin, destination) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(latitudeOf(destination) - latitudeOf(origin));
  const longitudeDelta = toRadians(longitudeOf(destination) - longitudeOf(origin));
  const latitudeA = toRadians(latitudeOf(origin));
  const latitudeB = toRadians(latitudeOf(destination));

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

export function buildFallbackRoadDistanceKm(origin, destination) {
  return haversineKm(origin, destination) * ROAD_DISTANCE_FALLBACK_FACTOR;
}

export function calculateStationMetrics(
  station,
  settings,
  routeDistanceKm,
  routeDurationMin = null,
  routeMode = "road"
) {
  const directDistanceKm = haversineKm(settings.origin, station);
  const tripDistanceKm = routeDistanceKm * (settings.roundTrip ? 2 : 1);
  const tripDurationMin =
    routeDurationMin === null ? null : routeDurationMin * (settings.roundTrip ? 2 : 1);
  const travelFuelLiters = (tripDistanceKm * settings.consumptionLitersPer100Km) / 100;
  const refillCost = station.price * settings.litersToBuy;
  const travelCost = station.price * travelFuelLiters;
  const effectiveTotalCost = refillCost + travelCost;
  const effectivePricePerNetLiter = effectiveTotalCost / settings.litersToBuy;

  return {
    ...station,
    directDistanceKm,
    routeDistanceKm,
    routeDurationMin,
    tripDistanceKm,
    tripDurationMin,
    travelFuelLiters,
    refillCost,
    travelCost,
    effectiveTotalCost,
    effectivePricePerNetLiter,
    routeMode
  };
}

export function calculateBreakEvenLiters(cheaperStation, closerStation) {
  if (!cheaperStation || !closerStation) {
    return null;
  }

  if (cheaperStation.price >= closerStation.price) {
    return null;
  }

  const numerator =
    cheaperStation.price * cheaperStation.travelFuelLiters -
    closerStation.price * closerStation.travelFuelLiters;
  const denominator = closerStation.price - cheaperStation.price;

  if (denominator <= 0) {
    return null;
  }

  const liters = numerator / denominator;

  if (!Number.isFinite(liters)) {
    return null;
  }

  return liters > 0 ? liters : 0;
}

export function analyzeStations(stations) {
  const orderedStations = [...stations].sort((left, right) => {
    if (left.effectiveTotalCost !== right.effectiveTotalCost) {
      return left.effectiveTotalCost - right.effectiveTotalCost;
    }

    if (left.price !== right.price) {
      return left.price - right.price;
    }

    return left.routeDistanceKm - right.routeDistanceKm;
  });

  const cheapestByPump =
    [...stations].sort((left, right) => {
      if (left.price !== right.price) {
        return left.price - right.price;
      }

      return left.routeDistanceKm - right.routeDistanceKm;
    })[0] || null;

  const bestByEffectiveCost = orderedStations[0] || null;
  const breakEvenLiters =
    cheapestByPump && bestByEffectiveCost && cheapestByPump.id !== bestByEffectiveCost.id
      ? calculateBreakEvenLiters(cheapestByPump, bestByEffectiveCost)
      : null;

  return {
    stations: orderedStations,
    totalCandidates: orderedStations.length,
    cheapestByPump,
    bestByEffectiveCost,
    breakEvenLiters
  };
}
