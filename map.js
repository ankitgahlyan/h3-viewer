let map, hexLayer, userMarkerLayer, streetLayer, satelliteLayer;

const GeoUtils = {
    EARTH_RADIUS_METERS: 6371000,

    radiansToDegrees: (r) => r * 180 / Math.PI,
    degreesToRadians: (d) => d * Math.PI / 180,

    getDistanceOnEarthInMeters: (lat1, lon1, lat2, lon2) => {
        const lat1Rad  = GeoUtils.degreesToRadians(lat1);
        const lat2Rad  = GeoUtils.degreesToRadians(lat2);
        const lonDelta = GeoUtils.degreesToRadians(lon2 - lon1);
        const x = Math.sin(lat1Rad) * Math.sin(lat2Rad) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lonDelta);
        return GeoUtils.EARTH_RADIUS_METERS * Math.acos(Math.max(Math.min(x, 1), -1));
    }
};

const ZOOM_TO_H3_RES_CORRESPONDENCE = {
    5: 1,
    6: 2,
    7: 3,
    8: 3,
    9: 4,
    10: 5,
    11: 6,
    12: 6,
    13: 7,
    14: 8,
    15: 9,
    16: 9,
    17: 10,
    18: 10,
    19: 11,
    20: 11,
    21: 12,
    22: 13,
    23: 14,
    24: 15,
};

const H3_RES_TO_ZOOM_CORRESPONDENCE = {};
for (const [zoom, res] of Object.entries(ZOOM_TO_H3_RES_CORRESPONDENCE)) {
    H3_RES_TO_ZOOM_CORRESPONDENCE[res] = zoom;
}

const getH3ResForMapZoom = (mapZoom) => {
    return ZOOM_TO_H3_RES_CORRESPONDENCE[mapZoom] ?? Math.floor((mapZoom - 1) * 0.7);
};

const h3BoundsToPolygon = (lngLatH3Bounds) => {
    const coordinates = lngLatH3Bounds.map(c => [c[0], c[1]]);
    for (let i = 1; i < coordinates.length; i++) {
        const prev = coordinates[i - 1];
        const current = coordinates[i];
        let lngDiff = current[1] - prev[1];

        if (lngDiff < -180) {
            current[1] += 360;
        } else if (lngDiff > 180) {
            current[1] -= 360;
        }
    }
    coordinates.push(coordinates[0]); // "close" the polygon
    return coordinates;
};

/**
 * Parse the current Query String and return its components as an object.
 */
const parseQueryString = () => {
    const queryString = window.location.search;
    const query = {};
    const pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i].split('=');
        query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return query;
};

const queryParams = parseQueryString();

const copyToClipboard = (text) => {
    const dummy = document.createElement("textarea");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
};

const createLocationPinIcon = (color = "#dc3545") => {
    return L.divIcon({
        className: 'custom-location-pin',
        html: `<div style="
            position: relative;
            transform: translate(-50%, -100%);
            cursor: pointer;
            filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));
        ">
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
                <path fill="${color}" stroke="#ffffff" stroke-width="1.5" d="M15 0C6.716 0 0 6.716 0 15c0 10.2 13.2 23.5 14.3 24.6.4.4 1 .4 1.4 0C16.8 38.5 30 25.2 30 15 30 6.716 23.284 0 15 0z"/>
                <circle fill="#ffffff" cx="15" cy="14" r="5"/>
                <circle fill="${color}" cx="15" cy="14" r="2.5"/>
            </svg>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
    });
};

const MIN_ZOOM_FOR_RES = {
    0: 1,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 6,
    6: 7,
    7: 9,
    8: 10,
    9: 12,
    10: 13,
    11: 15,
    12: 16,
    13: 18,
    14: 19,
    15: 20
};

var app = new Vue({
    el: "#app",

    data: {
        searchH3Id: undefined,
        searchPlusCode: undefined,
        gotoLatLon: undefined,
        currentH3Res: 9,
        sliderRes: 9,
        useIntegerFormat: !!queryParams.useIntegerFormat,
        isLocating: false,
        locationError: null,
        permissionState: 'unknown',
        showPermissionModal: false,
        isResLocked: queryParams.lockRes !== undefined ? (queryParams.lockRes === '1' || queryParams.lockRes === 'true') : true,
        lockedRes: 9,
        tooManyCells: false,
        currentLayer: queryParams.layer === 'satellite' ? 'satellite' : 'street',
        isToolboxPinned: false,
        isToolboxHovered: false,
        showSettings: false,
        cacheSizeText: 'Calculating...',
        isClearingCache: false,
        cacheClearedMessage: null,
    },

    computed: {
        isToolboxVisible: function() {
            return this.isToolboxPinned || this.isToolboxHovered || this.showSettings;
        },
        isToolboxOpen: function() {
            return this.isToolboxPinned || this.isToolboxHovered || this.showSettings;
        }
    },

    watch: {
        useIntegerFormat: function(newVal) {
            if (this.searchH3Id) {
                if (newVal && !this.isIntegerFormat(this.searchH3Id)) {
                    this.searchH3Id = this.h3ToInteger(this.searchH3Id);
                } else if (!newVal && this.isIntegerFormat(this.searchH3Id)) {
                    this.searchH3Id = this.integerToH3(this.searchH3Id);
                }
            }
        }
    },

    methods: {

        openPermissionModal: function() {
            this.showPermissionModal = true;
        },

        closePermissionModal: function() {
            this.showPermissionModal = false;
        },

        initPermissions: function() {
            if (navigator.permissions && navigator.permissions.query) {
                navigator.permissions.query({ name: 'geolocation' })
                    .then((status) => {
                        this.permissionState = status.state;
                        status.onchange = () => {
                            this.permissionState = status.state;
                            if (status.state === 'granted') {
                                if (this.showPermissionModal) {
                                    this.showPermissionModal = false;
                                    this.locationError = null;
                                    this.goToCurrentLocation({ silent: false });
                                }
                            } else if (status.state === 'denied') {
                                this.permissionState = 'denied';
                            }
                        };
                    })
                    .catch(() => {
                        this.permissionState = 'unknown';
                    });
            } else {
                this.permissionState = (!navigator.geolocation) ? 'unsupported' : 'unknown';
            }

            // Check permissions when user switches back to this tab
            window.addEventListener('focus', () => {
                this.checkPermissionState();
            });
        },

        checkPermissionState: async function() {
            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const status = await navigator.permissions.query({ name: 'geolocation' });
                    this.permissionState = status.state;
                    if (status.state === 'granted' && this.showPermissionModal) {
                        this.showPermissionModal = false;
                        this.locationError = null;
                        this.goToCurrentLocation({ silent: false });
                    }
                } catch (e) {}
            }
        },

        requestPermissionAgain: function() {
            this.goToCurrentLocation({ interactive: true, forcePrompt: true });
        },

        openSettings: function() {
            this.showSettings = true;
            this.getCacheStats();
        },

        closeSettings: function() {
            this.showSettings = false;
        },

        getCacheStats: async function() {
            this.cacheSizeText = 'Calculating...';
            if (!('caches' in window)) {
                this.cacheSizeText = 'Not supported';
                return;
            }
            try {
                let tileCount = 0;
                if (await caches.has('h3-viewer-tiles-v1')) {
                    const cache = await caches.open('h3-viewer-tiles-v1');
                    const keys = await cache.keys();
                    tileCount = keys.length;
                }

                let usageText = '';
                if (navigator.storage && navigator.storage.estimate) {
                    const estimate = await navigator.storage.estimate();
                    const bytes = estimate.usage || 0;
                    if (bytes > 1024 * 1024) {
                        usageText = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
                    } else if (bytes > 1024) {
                        usageText = (bytes / 1024).toFixed(1) + ' KB';
                    } else if (bytes > 0) {
                        usageText = bytes + ' B';
                    }
                }

                if (usageText) {
                    this.cacheSizeText = `${usageText} (${tileCount.toLocaleString()} tiles)`;
                } else {
                    this.cacheSizeText = `${tileCount.toLocaleString()} tiles`;
                }
            } catch (err) {
                this.cacheSizeText = 'Unavailable';
            }
        },

        clearMapCache: async function() {
            this.isClearingCache = true;
            this.cacheClearedMessage = null;
            try {
                if ('caches' in window) {
                    await caches.delete('h3-viewer-tiles-v1');
                    await caches.open('h3-viewer-tiles-v1');
                }
                await this.getCacheStats();
                this.cacheClearedMessage = 'Map cache cleared successfully!';
                setTimeout(() => {
                    this.cacheClearedMessage = null;
                }, 4000);
            } catch (err) {
                this.cacheClearedMessage = 'Failed to clear cache: ' + (err.message || err);
            } finally {
                this.isClearingCache = false;
            }
        },

        toggleToolbox: function() {
            this.isToolboxPinned = !this.isToolboxPinned;
        },

        closeToolbox: function() {
            this.isToolboxPinned = false;
            this.isToolboxHovered = false;
        },

        onToolboxHover: function(state) {
            this.isToolboxHovered = state;
        },

        setMapLayer: function(layerName) {
            if (!map) return;
            this.currentLayer = layerName;
            if (layerName === 'satellite') {
                if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
                if (!map.hasLayer(satelliteLayer)) satelliteLayer.addTo(map);
            } else {
                if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
                if (!map.hasLayer(streetLayer)) streetLayer.addTo(map);
            }
            this.updateMapDisplay();
        },

        h3ToInteger: function(h3id) {
            return BigInt('0x' + h3id).toString();
        },

        integerToH3: function(intStr) {
            return BigInt(intStr).toString(16);
        },

        isIntegerFormat: function(str) {
            return /^\d+$/.test(str);
        },

        normalizeH3Input: function(input) {
            if (!input) return input;
            if (this.isIntegerFormat(input)) {
                return this.integerToH3(input);
            }
            return input;
        },

        onCellClick: function(h3id, h3idInt) {
            const copyVal = this.useIntegerFormat ? h3idInt : h3id;
            copyToClipboard(copyVal);

            // Auto-fill search boxes for clicked cell
            this.searchH3Id = copyVal;

            const [lat, lng] = h3.cellToLatLng(h3id);
            this.gotoLatLon = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

            if (typeof OpenLocationCode !== "undefined") {
                try {
                    const olc = new OpenLocationCode();
                    this.searchPlusCode = olc.encode(lat, lng, 10);
                } catch (e) {}
            }

            this.updateMapDisplay();
        },

        onSliderInput: function() {
            this.isResLocked = true;
            this.lockedRes = parseInt(this.sliderRes, 10);
            this.currentH3Res = this.lockedRes;
            this.updateMapDisplay();
        },

        toggleResLock: function() {
            this.isResLocked = !this.isResLocked;
            if (this.isResLocked) {
                this.lockedRes = parseInt(this.sliderRes, 10);
                this.currentH3Res = this.lockedRes;
            } else {
                const zoom = map ? map.getZoom() : 5;
                this.currentH3Res = getH3ResForMapZoom(zoom);
                this.sliderRes = this.currentH3Res;
            }
            this.updateMapDisplay();
        },

        computeAverageEdgeLengthInMeters: function(vertexLocations) {
            let totalLength = 0;
            let edgeCount = 0;
            for (let i = 1; i < vertexLocations.length; i++) {
                const [fromLat, fromLng] = vertexLocations[i - 1];
                const [toLat, toLng] = vertexLocations[i];
                const edgeDistance = GeoUtils.getDistanceOnEarthInMeters(fromLat, fromLng, toLat, toLng);
                totalLength += edgeDistance;
                edgeCount++;
            }
            return totalLength / edgeCount;
        },

        updateMapDisplay: function() {
            if (hexLayer) {
                hexLayer.remove();
            }

            hexLayer = L.layerGroup().addTo(map);

            const zoom = map.getZoom();
            if (this.isResLocked) {
                this.currentH3Res = this.lockedRes ?? 9;
                this.sliderRes = this.currentH3Res;
            } else {
                this.currentH3Res = getH3ResForMapZoom(zoom);
                this.sliderRes = this.currentH3Res;
            }
            const { _southWest: sw, _northEast: ne} = map.getBounds();

            const boundsPolygon =[
                [ sw.lat, sw.lng ],
                [ ne.lat, sw.lng ],
                [ ne.lat, ne.lng ],
                [ sw.lat, ne.lng ],
                [ sw.lat, sw.lng ],
            ];

            let h3s = [];
            this.tooManyCells = false;

            const minZoom = MIN_ZOOM_FOR_RES[this.currentH3Res] ?? 1;
            // When locked to a high resolution, prevent browser freezing if zoomed out too far
            if (this.isResLocked && zoom < minZoom) {
                this.tooManyCells = true;
            } else {
                try {
                    h3s = h3.polygonToCells(boundsPolygon, this.currentH3Res);
                    if (h3s.length > 2500) {
                        this.tooManyCells = true;
                        h3s = h3s.slice(0, 2500);
                    }
                } catch (err) {
                    this.tooManyCells = true;
                    h3s = [];
                }
            }

            // If a searched/located cell exists, ensure it is rendered even if viewport is wide
            const normalizedSearchId = this.normalizeH3Input(this.searchH3Id);
            if (normalizedSearchId && !h3s.includes(normalizedSearchId) && h3.isValidCell(normalizedSearchId) && h3.getResolution(normalizedSearchId) === this.currentH3Res) {
                h3s.push(normalizedSearchId);
            }

            for (const h3id of h3s) {

                const polygonLayer = L.layerGroup()
                    .addTo(hexLayer);

                const isSelected = h3id === normalizedSearchId;

                const style = isSelected ? {
                    fillColor: "green",
                    fillOpacity: 0.30,
                    color: "#16a34a",
                    weight: 3,
                    opacity: 0.95
                } : {};

                const h3Bounds = h3.cellToBoundary(h3id);
                const averageEdgeLength = this.computeAverageEdgeLengthInMeters(h3Bounds);
                const cellArea = h3.cellArea(h3id, "m2");
                const h3idInt = this.h3ToInteger(h3id);

                let plusCodeLine = "";
                if (typeof OpenLocationCode !== "undefined") {
                    try {
                        const [cLat, cLng] = h3.cellToLatLng(h3id);
                        const cellPlusCode = (new OpenLocationCode()).encode(cLat, cLng, 10);
                        plusCodeLine = `<br />Plus Code: <b>${cellPlusCode}</b>`;
                    } catch(e) {}
                }

                const tooltipText = `
                Cell ID (str): <b>${ h3id }</b>
                <br />
                Cell ID (int): <b>${ h3idInt }</b>
                ${ plusCodeLine }
                <br />
                Average edge length (m): <b>${ averageEdgeLength.toLocaleString() }</b>
                <br />
                Cell area (m²): <b>${ cellArea.toLocaleString() }</b>
                `;

                const h3Polygon = L.polygon(h3BoundsToPolygon(h3Bounds), style)
                    .on('click', () => this.onCellClick(h3id, h3idInt))
                    .bindTooltip(tooltipText)
                    .addTo(polygonLayer);

                // less SVG, otherwise perf is bad
                if (Math.random() > 0.8 || isSelected) {
                    var svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                    svgElement.setAttribute('xmlns', "http://www.w3.org/2000/svg");
                    svgElement.setAttribute('viewBox', "0 0 200 200");
                    svgElement.innerHTML = `<text x="20" y="70" class="h3Text">${h3id}</text>`;
                    var svgElementBounds = h3Polygon.getBounds();
                    L.svgOverlay(svgElement, svgElementBounds).addTo(polygonLayer);
                }
            }
        },

        gotoLocation: function() {
            const input = (this.gotoLatLon || "").trim();
            if (!input) return;

            // If user entered a Plus Code into the coordinate box, delegate to findPlusCode
            if (input.includes("+")) {
                this.searchPlusCode = input;
                this.findPlusCode();
                return;
            }

            const [lat, lon] = input.split(",").map(Number);
            if (Number.isFinite(lat) && Number.isFinite(lon)
                && lat <= 90 && lat >= -90 && lon <= 180 && lon >= -180) {
                map.setView(
                    [lat, lon],
                    undefined, // don't change zoom level
                    { animate: true }
                );
            }
        },

        goToCurrentLocation: function(options = {}) {
            if (!navigator.geolocation) {
                this.locationError = "Geolocation is not supported by your browser.";
                this.permissionState = 'unsupported';
                return;
            }

            // If permission was already denied and this is not a forced check, show help modal immediately
            if (this.permissionState === 'denied' && !options.forcePrompt) {
                this.showPermissionModal = true;
                this.locationError = "Location permission is denied or blocked. Please enable it in your browser settings.";
                return;
            }

            this.isLocating = true;
            this.locationError = null;

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.isLocating = false;
                    this.permissionState = 'granted';
                    this.showPermissionModal = false;
                    this.locationError = null;
                    const { latitude, longitude, accuracy } = position.coords;
                    this.gotoLatLon = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

                    // Calculate Level 9 H3 cell for current location
                    const h3Id = h3.latLngToCell(latitude, longitude, 9);
                    this.searchH3Id = h3Id;
                    this.sliderRes = 9;
                    this.lockedRes = 9;
                    this.isResLocked = true;

                    // Encode user's Plus Code if OpenLocationCode is available
                    let plusCodeText = "";
                    if (typeof OpenLocationCode !== "undefined") {
                        try {
                            const olc = new OpenLocationCode();
                            this.searchPlusCode = olc.encode(latitude, longitude, 10);
                            plusCodeText = `<br>Plus Code: <code>${this.searchPlusCode}</code>`;
                        } catch (e) {}
                    }

                    // Navigate to the H3 cell and set zoom
                    this.findH3();

                    // Render RED location pin and accuracy circle for current location
                    if (userMarkerLayer) {
                        userMarkerLayer.clearLayers();
                    } else {
                        userMarkerLayer = L.layerGroup().addTo(map);
                    }

                    const accuracyCircle = L.circle([latitude, longitude], {
                        radius: accuracy || 25,
                        fillColor: "#dc3545",
                        color: "#dc3545",
                        weight: 1,
                        opacity: 0.35,
                        fillOpacity: 0.1
                    });

                    const marker = L.marker([latitude, longitude], {
                        icon: createLocationPinIcon("#dc3545")
                    }).bindTooltip(`<b>Current Location</b><br>Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}${plusCodeText}<br>H3 (Res 9): <code>${h3Id}</code>`, { direction: 'top', offset: [0, -40] });

                    userMarkerLayer.addLayer(accuracyCircle);
                    userMarkerLayer.addLayer(marker);
                },
                (error) => {
                    this.isLocating = false;
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            this.permissionState = 'denied';
                            this.locationError = "Location permission was denied. Please enable location permissions in your browser settings.";
                            this.showPermissionModal = true;
                            break;
                        case error.POSITION_UNAVAILABLE:
                            this.locationError = "Location information is unavailable. Please turn on device location/GPS.";
                            this.showPermissionModal = true;
                            break;
                        case error.TIMEOUT:
                            this.locationError = "Location request timed out. Please try again.";
                            break;
                        default:
                            this.locationError = "Unable to retrieve location: " + (error.message || "Unknown error");
                            break;
                    }
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        },

        findPlusCode: function() {
            if (!this.searchPlusCode || !this.searchPlusCode.trim()) return;
            const code = this.searchPlusCode.trim();

            if (typeof OpenLocationCode === "undefined") {
                this.locationError = "Plus Code library not loaded yet. Please try again.";
                return;
            }

            const olc = new OpenLocationCode();
            let fullCode = code;

            if (olc.isShort(code)) {
                const center = map ? map.getCenter() : { lat: 0, lng: 0 };
                try {
                    fullCode = olc.recoverNearest(code, center.lat, center.lng);
                } catch (e) {
                    this.locationError = `Could not recover short Plus Code: "${code}". Please enter a full Plus Code (e.g. 849VQHFJ+X6).`;
                    return;
                }
            }

            if (!olc.isFull(fullCode)) {
                this.locationError = `Invalid Plus Code: "${code}". Example format: 87G8Q222+ or 849VQHFJ+X6`;
                return;
            }

            try {
                this.locationError = null;
                const codeArea = olc.decode(fullCode);
                const lat = codeArea.latitudeCenter;
                const lng = codeArea.longitudeCenter;

                this.gotoLatLon = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

                const targetRes = this.isResLocked ? (this.lockedRes ?? 9) : (this.currentH3Res ?? 9);
                const h3Id = h3.latLngToCell(lat, lng, targetRes);
                this.searchH3Id = h3Id;

                const bounds = L.latLngBounds(
                    [codeArea.latitudeLo, codeArea.longitudeLo],
                    [codeArea.latitudeHi, codeArea.longitudeHi]
                );

                map.fitBounds(bounds, { maxZoom: H3_RES_TO_ZOOM_CORRESPONDENCE[targetRes] ?? 16 });

                // Add pin for Plus Code location
                if (userMarkerLayer) {
                    userMarkerLayer.clearLayers();
                } else {
                    userMarkerLayer = L.layerGroup().addTo(map);
                }

                const marker = L.marker([lat, lng], {
                    icon: createLocationPinIcon("#17a2b8")
                }).bindTooltip(`<b>Plus Code: ${fullCode}</b><br>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}<br>H3 (Res ${targetRes}): <code>${h3Id}</code>`, { direction: 'top', offset: [0, -40] });

                userMarkerLayer.addLayer(marker);
                this.updateMapDisplay();
            } catch (err) {
                this.locationError = "Error decoding Plus Code: " + (err.message || err);
            }
        },

        findH3: function() {
            const normalizedId = this.normalizeH3Input(this.searchH3Id);
            if (!h3.isValidCell(normalizedId)) {
                return;
            }
            this.searchH3Id = normalizedId;
            const h3Boundary = h3.cellToBoundary(this.searchH3Id);

            let bounds = undefined;

            for (const [lat, lng] of h3Boundary) {
                if (bounds === undefined) {
                    bounds = new L.LatLngBounds([lat, lng], [lat, lng]);
                } else {
                    bounds.extend([lat, lng]);
                }
            }

            map.fitBounds(bounds);

            const newZoom = H3_RES_TO_ZOOM_CORRESPONDENCE[h3.getResolution(this.searchH3Id)];
            map.setZoom(newZoom);
        }
    },

    beforeMount() {
    },

    mounted() {
        const init = () => {
            if (map) return;

            const southWest = L.latLng(-90, -179.999);
            const northEast = L.latLng(90, 179.999);
            const bounds = L.latLngBounds(southWest, northEast);
            map = L.map('mapid', { maxBounds: bounds });

            streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                minZoom: 2,
                maxNativeZoom: 19,
                maxZoom: 24,
                attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
            });

            const satelliteImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                minZoom: 2,
                maxNativeZoom: 19,
                maxZoom: 24,
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            });

            const satelliteTransportation = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
                minZoom: 2,
                maxNativeZoom: 19,
                maxZoom: 24,
                attribution: 'Roads &copy; Esri'
            });

            const satelliteBoundaries = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
                minZoom: 2,
                maxNativeZoom: 19,
                maxZoom: 24,
                attribution: 'Boundaries &copy; Esri'
            });

            satelliteLayer = L.layerGroup([satelliteImagery, satelliteTransportation, satelliteBoundaries]);

            if (this.currentLayer === 'satellite') {
                satelliteLayer.addTo(map);
            } else {
                streetLayer.addTo(map);
            }
            pointsLayer = L.layerGroup([]).addTo(map);

            const initialLat = queryParams.lat ?? 0;
            const initialLng = queryParams.lng ?? 0;
            const initialZoom = queryParams.zoom ?? 5;
            map.setView([initialLat, initialLng], initialZoom);
            map.on("zoomend", this.updateMapDisplay);
            map.on("moveend", this.updateMapDisplay);
            map.on("click", () => {
                if (window.innerWidth <= 768) {
                    this.closeToolbox();
                }
            });

            // Register Service Worker for Map Tile and Asset Caching
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('./sw.js').then((registration) => {
                        console.log('H3 Viewer ServiceWorker registered:', registration.scope);
                    }).catch((error) => {
                        console.warn('H3 Viewer ServiceWorker registration failed:', error);
                    });
                });
            }

            // Initialize Permission Monitoring (silently query status)
            this.initPermissions();

            const hasExplicitLocation = queryParams.h3 || queryParams.pluscode || queryParams.plusCode || queryParams.olc || (queryParams.lat !== undefined && queryParams.lng !== undefined);

            if (hasExplicitLocation) {
                const { h3 } = queryParams;
                if (h3) {
                    this.searchH3Id = h3;
                    window.setTimeout(() => this.findH3(), 50);
                }

                const plusCode = queryParams.pluscode || queryParams.plusCode || queryParams.olc;
                if (plusCode) {
                    this.searchPlusCode = plusCode;
                    window.setTimeout(() => this.findPlusCode(), 50);
                }
            }

            this.updateMapDisplay();
        };

        if (document.readyState === 'loading') {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }
});
