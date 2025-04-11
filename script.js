// Configuration
const OPENWEATHER_KEY = "cc89ee52f5cdf7cd8a3915cba042774f";
const OPENCAGE_KEY = "c8757ad0a33247e98b6faf04d8ed744f";

// Initialize map
const map = L.map("map").setView([18.5204, 73.8567], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// DOM elements
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const findRouteBtn = document.getElementById("find-route");
const statusDiv = document.getElementById("status");

// State
let currentMarkers = [];
let routePolylines = [];
let routingControl = null;
let aqiBadgeMarkers = []; 
// AQI colors
const aqiColors = {
    1: "#00e400", 2: "#ffff00", 3: "#ff7e00",
    4: "#ff0000", 5: "#8f3f97", unavailable: "#cccccc"
};

// Initialize
addAQILegend();

// Core functions
function addAQILegend() {
    const legend = L.control({ position: "bottomright" });
    legend.onAdd = () => {
        const div = L.DomUtil.create("div", "aqi-legend");
        div.innerHTML = "<h4>AQI Levels</h4>";

        [1, 2, 3, 4, 5].forEach(i => {
            div.innerHTML += `
        <div class="legend-item">
          <div class="legend-color" style="background:${aqiColors[i]}"></div>
          <span>${i} - ${["Good", "Fair", "Moderate", "Poor", "Very Poor"][i - 1]}</span>
        </div>
      `;
        });

        return div;
    };
    legend.addTo(map);
}

function clearMap() {
    currentMarkers.forEach(marker => map.removeLayer(marker));
    routePolylines.forEach(polyline => map.removeLayer(polyline));
    if (routingControl) map.removeControl(routingControl);
    currentMarkers = [];
    routePolylines = [];
}

function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.className = isError ? "error" : "info";
    statusDiv.style.display = "block";
    if (!isError) setTimeout(() => statusDiv.style.display = "none", 5000);
}

async function geocodeAddress(location) {
    try {
        const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(location)}&key=${OPENCAGE_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        return L.latLng(data.results[0].geometry.lat, data.results[0].geometry.lng);
    } catch (error) {
        throw new Error("Location not found");
    }
}

async function getAQI(lat, lng) {
    try {
        const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        return data.list?.[0]?.main?.aqi || -1;
    } catch {
        return -1;
    }
}

async function addMarker(point, label) {
    const aqi = await getAQI(point.lat, point.lng);
    const color = aqiColors[aqi] || aqiColors.unavailable;

    // Create standard pin marker
    const marker = L.marker(point, {
        icon: new L.Icon({
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34]
        }),
        riseOnHover: true
    });

    // Add AQI badge
    const aqiBadge = L.divIcon({
        className: 'aqi-badge',
        html: `<div style="background:${color}">${aqi > 0 ? aqi : '?'}</div>`,
        iconSize: [20, 20]
    });

    // Add badge to map
    L.marker(point, {
        icon: aqiBadge,
        zIndexOffset: 1000,
        interactive: false
    }).addTo(map);

    // Bind popup and add to map
    marker.bindPopup(`${label}<br>AQI: ${aqi > 0 ? aqi : 'N/A'}`).addTo(map);
    currentMarkers.push(marker);
    return marker;
}

async function processRoutes(routes) {
    routePolylines = [];

    for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        let totalAQI = 0, count = 0;

        // Calculate average AQI
        for (let j = 0; j < route.coordinates.length; j += Math.max(5, Math.floor(route.coordinates.length / 20))) {
            const { lat, lng } = route.coordinates[j];
            const aqi = await getAQI(lat, lng);
            if (aqi !== -1) { totalAQI += aqi; count++; }
        }
        const avgAQI = count > 0 ? (totalAQI / count) : -1;
        const routeColor = aqiColors[avgAQI !== -1 ? Math.round(avgAQI) : 'unavailable'];

        // Create stable route line
        const polyline = L.polyline(route.coordinates, {
            color: routeColor,
            weight: 6,
            opacity: 0.9,
            className: 'route-line'
        }).on('click', (e) => {
            L.popup()
                .setLatLng(e.latlng)
                .setContent(`
            <b>Route ${i + 1}</b><br>
            Avg AQI: ${avgAQI === -1 ? 'N/A' : avgAQI.toFixed(1)}<br>
            ${route.summary?.totalDistance ? `Distance: ${(route.summary.totalDistance / 1000).toFixed(1)} km` : ''}
          `)
                .openOn(map);
        }).addTo(map);

        routePolylines.push(polyline);
    }

    // Fit bounds
    if (routes.length > 0) {
        map.fitBounds(L.latLngBounds(routes.flatMap(r => r.coordinates)).pad(0.2));
    }
}

// Event listeners
findRouteBtn.addEventListener("click", async () => {
    const start = startInput.value.trim();
    const end = endInput.value.trim();

    if (!start || !end) {
        showStatus("Please enter both locations", true);
        return;
    }

    try {
        showStatus("Finding route...");
        clearMap();

        const startPoint = await geocodeAddress(start);
        const endPoint = await geocodeAddress(end);

        await Promise.all([
            addMarker(startPoint, "Start"),
            addMarker(endPoint, "End")
        ]);

        if (routingControl) {
            map.removeControl(routingControl);
        }

        // Initialize new routing control with stable settings
        routingControl = L.Routing.control({
            waypoints: [startPoint, endPoint],
            routeWhileDragging: false,
            showAlternatives: true,
            addWaypoints: false,
            fitSelectedRoutes: false,
            createMarker: () => null,
            lineOptions: { styles: [] },     // prevent default route rendering
            altLineOptions: { styles: [] },  // prevent alternate route rendering
            router: L.Routing.osrmv1({
                serviceUrl: "https://router.project-osrm.org/route/v1"
            })
        }).addTo(map);

        // Add event listeners
        routingControl.on('routesfound', function (e) {
            processRoutes(e.routes);
        });

        routingControl.on('routingerror', function (e) {
            showStatus("Error finding route: " + e.error.message, true);
        });

    } catch (error) {
        showStatus(error.message, true);
    }
});

clearMap