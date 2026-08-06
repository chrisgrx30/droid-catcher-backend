// geo.js
//
// Lightweight geo helpers. In production, swap `cellId` for a real
// geohash library (e.g. `ngeohash`) at precision ~7 (~150m cells).
// This hand-rolled version buckets lat/lng into a fixed-size grid,
// which is enough to demonstrate the spawn/query pattern without
// needing network access to install a package.

const CELL_SIZE_DEG = 0.0015; // ~150m at mid-latitudes, matches geohash-7 roughly

function cellId(lat, lng) {
  const latCell = Math.floor(lat / CELL_SIZE_DEG);
  const lngCell = Math.floor(lng / CELL_SIZE_DEG);
  return `${latCell}:${lngCell}`;
}

// Returns the 3x3 block of cell ids around a point, used to cover a query radius
function neighboringCells(lat, lng) {
  const cells = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const latCell = Math.floor(lat / CELL_SIZE_DEG) + dLat;
      const lngCell = Math.floor(lng / CELL_SIZE_DEG) + dLng;
      cells.push(`${latCell}:${lngCell}`);
    }
  }
  return cells;
}

// Haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function randomPointInCell(cellIdStr) {
  const [latCell, lngCell] = cellIdStr.split(':').map(Number);
  const lat = latCell * CELL_SIZE_DEG + Math.random() * CELL_SIZE_DEG;
  const lng = lngCell * CELL_SIZE_DEG + Math.random() * CELL_SIZE_DEG;
  return { lat, lng };
}

module.exports = { cellId, neighboringCells, distanceMeters, randomPointInCell };
