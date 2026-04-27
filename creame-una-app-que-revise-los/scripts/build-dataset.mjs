import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "public", "data");
const outputFile = path.join(outputDir, "stations.es.json");

const ENDPOINT =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";

const DEFAULT_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Connection: "keep-alive",
  "User-Agent": "PostmanRuntime/7.43.4"
};

function pickFirstValue(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }

  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value).trim().replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function compactStation(rawStation) {
  const station = {
    id: String(pickFirstValue(rawStation, ["IDEESS"])),
    brand: pickFirstValue(rawStation, ["R\u00f3tulo", "Rotulo"]) || "Sin rotulo",
    address:
      pickFirstValue(rawStation, ["Direcci\u00f3n", "Direccion"]) || "Direccion no disponible",
    locality: pickFirstValue(rawStation, ["Localidad"]) || "Localidad no disponible",
    municipality: pickFirstValue(rawStation, ["Municipio"]) || "Municipio no disponible",
    province: pickFirstValue(rawStation, ["Provincia"]) || "Provincia no disponible",
    postalCode: pickFirstValue(rawStation, ["C.P."]) || "",
    schedule: pickFirstValue(rawStation, ["Horario"]) || "Horario no informado",
    lat: parseNumber(pickFirstValue(rawStation, ["Latitud", "Latitude"])),
    lon: parseNumber(
      pickFirstValue(rawStation, [
        "Longitud (WGS84)",
        "Longitud_x0020__x0028_WGS84_x0029_",
        "Longitud"
      ])
    ),
    prices: {
      "4": parseNumber(
        pickFirstValue(rawStation, [
          "Precio Gasoleo A",
          "Precio_x0020_Gasoleo_x0020_A",
          "PrecioProducto"
        ])
      ),
      "5": parseNumber(
        pickFirstValue(rawStation, [
          "Precio Gasoleo Premium",
          "Precio_x0020_Gasoleo_x0020_Premium"
        ])
      ),
      "27": parseNumber(
        pickFirstValue(rawStation, [
          "Precio Di\u00e9sel Renovable",
          "Precio_x0020_Di\u00e9sel_x0020_Renovable"
        ])
      )
    }
  };

  if (!station.id || station.lat === null || station.lon === null) {
    return null;
  }

  const hasDieselPrice = Object.values(station.prices).some((value) => value !== null);
  return hasDieselPrice ? station : null;
}

async function loadOfficialDataset() {
  const response = await fetch(ENDPOINT, {
    headers: DEFAULT_HEADERS
  });

  if (!response.ok) {
    throw new Error(`Respuesta remota ${response.status}`);
  }

  return response.json();
}

async function readExistingFile() {
  try {
    return await fs.readFile(outputFile, "utf8");
  } catch {
    return null;
  }
}

async function writeDataset(payload) {
  const stations = (payload.ListaEESSPrecio || [])
    .map((station) => compactStation(station))
    .filter(Boolean);

  const compactPayload = {
    source: "official",
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: payload.Fecha || null,
    stationCount: stations.length,
    stations
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(compactPayload));
}

try {
  const payload = await loadOfficialDataset();
  await writeDataset(payload);
  console.log(`Dataset actualizado: ${outputFile}`);
} catch (error) {
  const existing = await readExistingFile();

  if (existing) {
    console.warn(
      `No se ha podido refrescar el dataset oficial. Se conserva el fichero existente: ${error instanceof Error ? error.message : "error desconocido"}`
    );
    process.exit(0);
  }

  throw error;
}
