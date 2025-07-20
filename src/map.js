import * as config from './config.js';

// Ініціалізація мапи Leaflet
export const map = L.map('map').setView([45, 42], 6);

// Базові слої мапи
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

// Додаємо OSM шар за замовченням
osmLayer.addTo(map);

// Об'єкт з базовими шарами для контролера
const baseMaps = {
  "OpenStreetMap": osmLayer,
  "Супутник": satelliteLayer
};

const airbaseIcon = new L.Icon({
  iconUrl: 'assets/airbase_marker.png',
  iconSize: [30, 30],      // Приблизний розмір
  iconAnchor: [15, 30],    // Точка прив'язки (якір) - зазвичай нижній центр іконки
  popupAnchor: [0, -30]    // Зсув спливаючого вікна, щоб було над іконкою
});

const airbasesLayer = L.layerGroup();
config.airbases.forEach(ab => {
  L.marker(ab.coords, { icon: airbaseIcon })
    .addTo(airbasesLayer)
    .bindPopup(`<b>${ab.name}</b><br/>${ab.coords[0].toFixed(4)}, ${ab.coords[1].toFixed(4)}`);
});
airbasesLayer.addTo(map); // Додаємо шар на карту за замовчуванням

// Додаємо контролер шарів на карту
const overlayMaps = {
    "Аеродроми рф": airbasesLayer
};

// Додаємо контролер шарів на карту
L.control.layers(baseMaps, overlayMaps).addTo(map);

// Додаємо лінійку масштабу на карту (метрична система, без імперської)
L.control.scale({ metric: true, imperial: false }).addTo(map);