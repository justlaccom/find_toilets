// Variables globales
let userLocation = null;
let map = null;
let userMarker = null;
let stopMarkers = [];
let routeLine = null;
let realBusStops = [];

// Éléments DOM
const permissionBox = document.getElementById('location-permission');
const loadingBox = document.getElementById('loading');
const errorBox = document.getElementById('error-message');
const nearestStopBox = document.getElementById('nearest-stop');
const allStopsBox = document.getElementById('all-stops');
const mapContainer = document.getElementById('map');
const enableLocationBtn = document.getElementById('enable-location');
const showDirectionsBtn = document.getElementById('show-directions');
const closeMapBtn = document.getElementById('close-map');

// Récupérer les toilettes publiques depuis OpenStreetMap via l'API Overpass
async function fetchRealBusStops(lat, lng, radius = 2000) {
    const overpassQuery = `
        [out:json][timeout:25];
        (
          node["amenity"="toilets"](around:${radius},${lat},${lng});
          way["amenity"="toilets"](around:${radius},${lat},${lng});
          relation["amenity"="toilets"](around:${radius},${lat},${lng});
        );
        out body;
        >;
        out skel qt;
    `;
    
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        const stops = [];
        data.elements.forEach(element => {
            if (element.type === 'node' && element.lat && element.lon) {
                // Vérifier que c'est bien des toilettes publiques
                const tags = element.tags || {};
                
                // Inclure uniquement si c'est clairement des toilettes publiques
                if (tags.amenity === 'toilets' && tags.access !== 'private' && tags.access !== 'customers') {
                    stops.push({
                        id: element.id,
                        name: getToiletName(tags, element.id),
                        lat: element.lat,
                        lng: element.lon,
                        lines: getToiletFeatures(tags)
                    });
                }
            }
        });
        
        console.log(`Trouvé ${stops.length} toilettes publiques`);
        return stops;
    } catch (error) {
        console.error('Erreur lors de la récupération des toilettes:', error);
        return [];
    }
}

// Obtenir le nom des toilettes
function getToiletName(tags, id) {
    if (tags.name) {
        return tags.name;
    } else if (tags.operator) {
        return `Toilettes ${tags.operator}`;
    } else {
        return `Toilettes publiques ${id}`;
    }
}

// Obtenir les caractéristiques des toilettes
function getToiletFeatures(tags) {
    const features = [];
    
    if (tags.wheelchair === 'yes') {
        features.push('♿ Accès PMR');
    }
    
    if (tags.fee === 'no') {
        features.push('💰 Gratuit');
    } else if (tags.fee === 'yes') {
        features.push('💰 Payant');
    }
    
    if (tags.gender === 'male') {
        features.push('🚹 Hommes');
    } else if (tags.gender === 'female') {
        features.push('🚺 Femmes');
    } else if (tags.gender === 'unisex') {
        features.push('🚻 Mixtes');
    }
    
    if (tags.changing_table === 'yes') {
        features.push('👶 Table à langer');
    }
    
    if (features.length === 0) {
        features.push('🚽 Toilettes publiques');
    }
    
    return features;
}

// Charger les toilettes publiques
async function loadRealBusStops() {
    if (!userLocation) return;
    
    // Afficher un message de chargement
    loadingBox.innerHTML = `
        <div class="spinner"></div>
        <p>Recherche des toilettes publiques à proximité...</p>
    `;
    loadingBox.style.display = 'block';
    
    try {
        realBusStops = await fetchRealBusStops(userLocation.lat, userLocation.lng);
        
        if (realBusStops.length === 0) {
            // Essayer avec un rayon plus grand
            console.log('Aucune toilette trouvée à 2km, recherche sur 5km...');
            realBusStops = await fetchRealBusStops(userLocation.lat, userLocation.lng, 5000);
        }
        
        loadingBox.style.display = 'none';
        
        if (realBusStops.length === 0) {
            showError('Aucune toilette publique trouvée dans un rayon de 5km.');
        } else {
            console.log(`Trouvé ${realBusStops.length} toilettes publiques:`, realBusStops);
            findNearestStops();
        }
    } catch (error) {
        loadingBox.style.display = 'none';
        showError('Erreur lors de la recherche des toilettes publiques.');
        console.error(error);
    }
}
// Calculer la distance entre deux points (formule de Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance;
}

// Demander la localisation
function requestLocation() {
    permissionBox.style.display = 'none';
    loadingBox.style.display = 'block';
    
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                
                loadingBox.style.display = 'none';
                
                // Charger les vrais arrêts de bus
                loadRealBusStops();
            },
            (error) => {
                loadingBox.style.display = 'none';
                showError('Impossible d\'obtenir votre position. Veuillez autoriser la géolocalisation.');
                console.error('Erreur de géolocalisation:', error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000
            }
        );
    } else {
        loadingBox.style.display = 'none';
        showError('La géolocalisation n\'est pas supportée par votre navigateur.');
    }
}

// Trouver les toilettes les plus proches
function findNearestStops() {
    const stopsWithDistance = realBusStops.map(stop => ({
        ...stop,
        distance: calculateDistance(
            userLocation.lat, 
            userLocation.lng, 
            stop.lat, 
            stop.lng
        )
    }));
    
    // Trier par distance
    stopsWithDistance.sort((a, b) => a.distance - b.distance);
    
    // Afficher la toilette la plus proche
    displayNearestStop(stopsWithDistance[0]);
    
    // Afficher toutes les toilettes proches (moins de 5km)
    const nearbyStops = stopsWithDistance.filter(stop => stop.distance < 5);
    displayAllStops(nearbyStops);
}

// Afficher la toilette la plus proche
function displayNearestStop(stop) {
    document.getElementById('stop-name').textContent = stop.name;
    document.getElementById('stop-distance').textContent = 
        `📍 ${stop.distance.toFixed(2)} km de votre position`;
    document.getElementById('stop-lines').textContent = 
        `🚽 ${stop.lines.join(' • ')}`;
    
    nearestStopBox.style.display = 'block';
    nearestStopBox.classList.add('fade-in');
    
    // Stocker l'arrêt pour la carte
    nearestStopBox.dataset.stopId = stop.id;
}

// Afficher toutes les toilettes proches
function displayAllStops(stops) {
    const container = document.getElementById('stops-container');
    container.innerHTML = '';
    
    stops.forEach(stop => {
        const stopElement = document.createElement('div');
        stopElement.className = 'stop-item fade-in';
        stopElement.innerHTML = `
            <h4>${stop.name}</h4>
            <div class="distance">📍 ${stop.distance.toFixed(2)} km</div>
            <div class="lines">🚽 ${stop.lines.join(' • ')}</div>
        `;
        
        stopElement.addEventListener('click', () => showStopOnMap(stop));
        container.appendChild(stopElement);
    });
    
    allStopsBox.style.display = 'block';
}

// Afficher une erreur
function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
    errorBox.classList.add('fade-in');
}

// Initialiser la carte
function initMap() {
    mapContainer.style.display = 'block';
    
    if (!map) {
        map = L.map('map').setView([userLocation.lat, userLocation.lng], 14);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '',
            maxZoom: 19
        }).addTo(map);
        
        // Marqueur utilisateur
        const userIcon = L.divIcon({
            html: '<div style="background: #4285f4; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            className: 'user-marker'
        });
        
        userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
            .addTo(map)
            .bindPopup('Votre position')
            .openPopup();
    }
    
    // Ajouter les marqueurs d'arrêts
    addStopMarkers();
}

// Ajouter les marqueurs de toilettes sur la carte
function addStopMarkers() {
    // Supprimer les anciens marqueurs et lignes
    stopMarkers.forEach(marker => map.removeLayer(marker));
    stopMarkers = [];
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }
    
    // Trouver la toilette la plus proche
    const stopsWithDistance = realBusStops.map(stop => ({
        ...stop,
        distance: calculateDistance(
            userLocation.lat, 
            userLocation.lng, 
            stop.lat, 
            stop.lng
        )
    }));
    
    stopsWithDistance.sort((a, b) => a.distance - b.distance);
    const nearestStop = stopsWithDistance[0];
    
    realBusStops.forEach(stop => {
        const distance = calculateDistance(
            userLocation.lat, 
            userLocation.lng, 
            stop.lat, 
            stop.lng
        );
        
        // Seulement les toilettes à moins de 5km
        if (distance < 5) {
            const stopIcon = L.divIcon({
                html: '<div style="background: #8b4513; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
                iconSize: [16, 16],
                className: 'stop-marker'
            });
            
            const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon })
                .addTo(map)
                .bindPopup(`
                    <strong>${stop.name}</strong><br>
                    📍 ${distance.toFixed(2)} km<br>
                    🚽 ${stop.lines.join('<br>')}
                `);
            
            stopMarkers.push(marker);
            
            // Ajouter la ligne rouge jusqu'à la toilette la plus proche
            if (stop.id === nearestStop.id) {
                const routeCoordinates = [
                    [userLocation.lat, userLocation.lng],
                    [stop.lat, stop.lng]
                ];
                
                routeLine = L.polyline(routeCoordinates, {
                    color: '#ff0000',
                    weight:4,
                    opacity: 0.8,
                    dashArray: '10, 5'
                }).addTo(map);
            }
        }
    });
}

// Afficher un arrêt spécifique sur la carte
function showStopOnMap(stop) {
    initMap();
    map.setView([stop.lat, stop.lng], 16);
    
    // Trouver le marqueur et ouvrir son popup
    const marker = stopMarkers.find(m => {
        const pos = m.getLatLng();
        return Math.abs(pos.lat - stop.lat) < 0.0001 && Math.abs(pos.lng - stop.lng) < 0.0001;
    });
    
    if (marker) {
        marker.openPopup();
    }
}

// Fermer la carte
function closeMap() {
    mapContainer.style.display = 'none';
}

// Écouteurs d'événements
enableLocationBtn.addEventListener('click', requestLocation);
showDirectionsBtn.addEventListener('click', initMap);
closeMapBtn.addEventListener('click', closeMap);

// Fermer la carte avec la touche Échap
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mapContainer.style.display === 'block') {
        closeMap();
    }
});
