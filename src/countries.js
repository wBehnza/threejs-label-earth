import * as three from 'three';
import { latLonToVector3, vector3ToLatLon } from './helpers.js';
import countries from '../data/worldgeo.json';

export class Countries {
    constructor(scene, camera, requestRender) {
        this.scene = scene;
        this.camera = camera;
        this.requestRender = requestRender;
        this.countryGrid = []
        this.geoJson = [];
        this.countryGrid = null;
        this.countryLinesCache = {};
        this.currentCountryLine = null;
        this.lastMousePos = { x: 0, y: 0 };
        this.outlineMaterial = new three.LineBasicMaterial({ color: 0x39FF14 });
    }

    fetchGeoJson() {
        try {
            this.geoJson = countries;
            this.createCountryLookupGrid();
            console.log('Country grid built successfully');
        } catch (err) {
            console.error('Failed to load local country borders:', err);
        }
    }

    createCountryLookupGrid() {
        const gridWidth = 360;
        const gridHeight = 180;
        const countryGridData = new Int16Array(gridWidth * gridHeight);
        countryGridData.fill(-1);

        // country name <-> id
        const countryIdByName = new Map();
        const countryNameById = [];
        let nextCountryId = 0;

        // Precompute per-feature structure with edge buckets per Y row
        const countryFeatures = this.geoJson.features
            .filter(feature => feature.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"))
            .map(feature => {
                let countryId = countryIdByName.get(feature.properties.admin);
                if (countryId == null) {
                    countryId = nextCountryId++;
                    countryIdByName.set(feature.properties.admin, countryId);
                    countryNameById[countryId] = feature.properties.admin;
                }

                const polygons = (feature.geometry.type === "Polygon")
                    ? [feature.geometry.coordinates]
                    : feature.geometry.coordinates;

                // buckets[row] = array of edges [x1, y1, x2, y2] that cross this row’s latitude
                const edgeBucketsByRow = Array.from({ length: gridHeight }, () => []);
                let minLongitude = 180, minLatitude = 90, maxLongitude = -180, maxLatitude = -90;

                for (const polygon of polygons) {
                    for (const ring of polygon) {
                        // Update bounding box
                        for (const [lon, lat] of ring) {
                            if (lon < minLongitude) minLongitude = lon;
                            if (lon > maxLongitude) maxLongitude = lon;
                            if (lat < minLatitude) minLatitude = lat;
                            if (lat > maxLatitude) maxLatitude = lat;
                        }
                        // Bucket edges
                        for (let i = 0, prevIndex = ring.length - 1; i < ring.length; prevIndex = i++) {
                            const [x1, y1] = ring[prevIndex];
                            const [x2, y2] = ring[i];
                            if (y1 === y2) continue; // Skip horizontal edges

                            const minY = Math.min(y1, y2);
                            const maxY = Math.max(y1, y2);

                            const rowMin = Math.max(0, Math.floor(90 - maxY));
                            const rowMax = Math.min(gridHeight - 1, Math.floor(90 - minY));

                            for (let rowIndex = rowMin; rowIndex <= rowMax; rowIndex++) {
                                const latCenter = 90 - (rowIndex + 0.5);
                                if ((latCenter > y1) !== (latCenter > y2)) {
                                    edgeBucketsByRow[rowIndex].push(x1, y1, x2, y2);
                                }
                            }
                        }
                    }
                }

                // Clamp bbox to grid indices
                const gridX0 = Math.max(0, Math.floor(minLongitude + 180));
                const gridX1 = Math.min(gridWidth - 1, Math.floor(maxLongitude + 180));
                const gridY0 = Math.max(0, Math.floor(90 - maxLatitude));
                const gridY1 = Math.min(gridHeight - 1, Math.floor(90 - minLatitude));

                return { countryId, edgeBucketsByRow, gridX0, gridX1, gridY0, gridY1 };
            });

        // Fill grid
        for (const feature of countryFeatures) {
            for (let gridY = feature.gridY0; gridY <= feature.gridY1; gridY++) {
                const latCenter = 90 - (gridY + 0.5);
                const edgesForRow = feature.edgeBucketsByRow[gridY];
                if (!edgesForRow.length) continue;

                for (let gridX = feature.gridX0; gridX <= feature.gridX1; gridX++) {
                    const cellIndex = gridX * gridHeight + gridY;
                    if (countryGridData[cellIndex] !== -1) continue; // Already filled

                    const lonCenter = (gridX + 0.5) - 180;
                    let isInside = false;

                    for (let edgeIndex = 0; edgeIndex < edgesForRow.length; edgeIndex += 4) {
                        const x1 = edgesForRow[edgeIndex];
                        const y1 = edgesForRow[edgeIndex + 1];
                        const x2 = edgesForRow[edgeIndex + 2];
                        const y2 = edgesForRow[edgeIndex + 3];

                        const t = (latCenter - y1) / (y2 - y1);
                        const xCross = x1 + t * (x2 - x1);
                        if (lonCenter < xCross) isInside = !isInside;
                    }
                    if (isInside) countryGridData[cellIndex] = feature.countryId;
                }
            }
        }

        this.countryGrid = {
            data: countryGridData,
            names: countryNameById,
            width: gridWidth,
            height: gridHeight
        };
    }

    getCountryAt(lat, lon) {
        const countryGrid = this.countryGrid;
        if (!countryGrid) return null;
        const gridX = Math.max(0, Math.min(countryGrid.width - 1, Math.floor(lon + 180)));
        const gridY = Math.max(0, Math.min(countryGrid.height - 1, Math.floor(90 - lat)));
        const countryId = countryGrid.data[gridX * countryGrid.height + gridY];
        return countryId === -1 ? null : countryGrid.names[countryId];
    }

    drawCountryAt(lat, lon) {
        const country = this.getCountryAt(lat, lon);
        if (!country) {
            if (this.currentCountryLine) {
                this.scene.remove(this.currentCountryLine);
                this.currentCountryLine = null;
            }
            return;
        }
        this.drawCountry(country);
    }

    drawCountry(countryName) {
        if (this.currentCountryLine) {
            this.scene.remove(this.currentCountryLine);
            this.currentCountryLine = null;
        }

        let lineGroup = this.countryLinesCache[countryName];

        if (!lineGroup) {
            lineGroup = new three.Group();

            const feature = this.geoJson.features.find(f =>
                f.properties.admin === countryName
            );

            if (feature) {
                const material = this.outlineMaterial;
                const geom = feature.geometry;

                if (geom.type === "Polygon") {
                    this._addRingToGroup(lineGroup, geom.coordinates[0], material);
                }
                else if (geom.type === "MultiPolygon") {
                    geom.coordinates.forEach(poly => {
                        this._addRingToGroup(lineGroup, poly[0], material);
                    });
                }
            }
            this.countryLinesCache[countryName] = lineGroup;
        }

        this.scene.add(lineGroup);
        this.currentCountryLine = lineGroup;
        this.requestRender();
    }

    removeCurrentCountry() {
        if (this.currentCountryLine) {
            this.scene.remove(this.currentCountryLine);
            this.currentCountryLine = null;
            this.requestRender();
        }
    }

    _isPointInFeature(lon, lat, feature) {
        const geom = feature.geometry;
        if (geom.type === "Polygon") {
            return this._isPointInPolygon(lon, lat, geom.coordinates);
        } else if (geom.type === "MultiPolygon") {
            for (const poly of geom.coordinates) {
                if (this._isPointInPolygon(lon, lat, poly))
                    return true;
            }
        }
        return false;
    }

    _isPointInPolygon(lon, lat, polygon) {
        const [outerRing, ...holes] = polygon;
        if (!this._isPointInRing(lon, lat, outerRing)) return false;
        for (const hole of holes) {
            if (this._isPointInRing(lon, lat, hole)) return false;
        }
        return true;
    }

    _isPointInRing(lon, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];

            const slope = (xj - xi) / (yj - yi);
            const intersect = yi !== yj &&
                (lat > yi) !== (lat > yj) &&
                lon < xi + slope * (lat - yi);

            if (intersect) inside = !inside;
        }
        return inside;
    }

    _addRingToGroup(group, ring, material) {
        const points = ring.map(p => latLonToVector3(p[1], p[0], this.earthRadius));
        const geometry = new three.BufferGeometry().setFromPoints(points);
        const line = new three.Line(geometry, material);
        line.raycast = () => { };
        group.add(line);
    }
}
