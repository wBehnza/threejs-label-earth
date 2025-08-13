import { latLonToVector3 } from './helpers.js';
import labels from '../data/labels.json';
import * as three from 'three';

export class Labels {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.camera = camera;
        this.drawnLabels = [];
        this.maxDrawnLabels = 5000;

        this.context2D = this.canvas.getContext('2d');
        this.tempVector = new three.Vector3();
        this.modelViewProjectionMatrix = new three.Matrix4();
        this.viewMatrix = new three.Matrix4();
        this.projectionMatrix = new three.Matrix4();
        this.cameraDirection = new three.Vector3();
        this.viewFrustum = new three.Frustum();
        this.tempWorldPosition = new three.Vector3();   // world position
        this.tempCameraToPoint = new three.Vector3();   // camera->point

        this.fontSize = 14;
        this.font = `${this.fontSize}px sans-serif`;
        this.paddingX = 3; this.paddingTop = 5; this.paddingBottom = 4;
        this.textMetricsCache = new Map();
    }

    setupLabelCanvas(container) {
        const devicePixelRatioValue = window.devicePixelRatio || 1;
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.canvas.width = Math.floor(width * devicePixelRatioValue);
        this.canvas.height = Math.floor(height * devicePixelRatioValue);
    }

    getLabelAtScreenPos(x, y, boundaries) {
        const localX = x - boundaries.left;
        const localY = y - boundaries.top;
        for (let i = this.drawnLabels.length - 1; i >= 0; i--) {
            const rect = this.drawnLabels[i].rect;
            if (localX >= rect.x && localX <= rect.x + rect.width &&
                localY >= rect.y && localY <= rect.y + rect.height) {
                return this.drawnLabels[i];
            }
        }
    }

    draw() {
        const ctx = this.context2D;
        const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
        const canvasHeight = this.canvas.height / (window.devicePixelRatio || 1);

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        this.drawnLabels = [];

        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.lineWidth = 1;

        const backgroundFillColor = 'black';
        const strokeColor = '#ff4d00';
        const textFillColor = 'white';

        this.viewMatrix.copy(this.camera.matrixWorldInverse);
        this.projectionMatrix.copy(this.camera.projectionMatrix);
        this.modelViewProjectionMatrix.multiplyMatrices(this.projectionMatrix, this.viewMatrix);
        this.viewFrustum.setFromProjectionMatrix(this.modelViewProjectionMatrix);
        this.camera.getWorldDirection(this.cameraDirection); // forward vector

        let labelsOutSideView = 0;
        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            const text = label.name;
            if (!text) continue;

            const worldPosition = this.tempWorldPosition.copy(latLonToVector3(label.lat, label.lon));

            if (this.camera.position.dot(worldPosition) < 1) {
                labelsOutSideView++;
                continue; // behind camera
            }
            if (!this.viewFrustum.containsPoint(worldPosition)) {
                labelsOutSideView++
                continue; // outside view frustum
            };
            if (this.drawnLabels.length >= this.maxDrawnLabels) break; // limit reached

            const ndcMargin = 0.02;
            const ndcCoords = this._toNDC(worldPosition);
            if (ndcCoords.x < -1 - ndcMargin || ndcCoords.x > 1 + ndcMargin ||
                ndcCoords.y < -1 - ndcMargin || ndcCoords.y > 1 + ndcMargin ||
                ndcCoords.w <= 0) continue;

            const pixelX = (ndcCoords.x + 1) * 0.5 * canvasWidth;
            const pixelY = (1 - ndcCoords.y) * 0.5 * canvasHeight;

            const metrics = this._measure(text);
            const boxWidth = metrics.width + this.paddingX * 2;
            const boxHeight = metrics.height;
            const boxX = pixelX - boxWidth / 2;
            const boxY = pixelY - boxHeight;

            if (boxX + boxWidth < 0 || boxX > canvasWidth || boxY + boxHeight < 0 || boxY > canvasHeight) continue;

            ctx.fillStyle = backgroundFillColor;
            ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
            ctx.strokeStyle = strokeColor;
            ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
            ctx.fillStyle = textFillColor;

            const textY = boxY + this.paddingTop + metrics.ascent;
            ctx.fillText(text, pixelX, textY);

            this.drawnLabels.push({
                lat: label.lat,
                lon: label.lon,
                name: label.name,
                description: label.description,
                rect: { x: boxX, y: boxY, width: boxWidth, height: boxHeight },
            });
        }
    }

    _measure(text) {
        let cachedMetrics = this.textMetricsCache.get(text);
        if (cachedMetrics) return cachedMetrics;

        this.context2D.font = this.font;
        const measurement = this.context2D.measureText(text);
        const ascent = (measurement.actualBoundingBoxAscent ?? Math.ceil(this.fontSize * 0.8));
        const descent = (measurement.actualBoundingBoxDescent ?? Math.ceil(this.fontSize * 0.2));
        const metrics = {
            width: measurement.width,
            ascent,
            descent,
            height: ascent + descent + this.paddingTop + this.paddingBottom
        };
        this.textMetricsCache.set(text, metrics);
        return metrics;
    }

    _toNDC(position) {
        const x = position.x, y = position.y, z = position.z;
        const e = this.modelViewProjectionMatrix.elements;

        const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
        const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
        const clipZ = e[2] * x + e[6] * y + e[10] * z + e[14];
        const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];

        const invW = clipW !== 0 ? 1 / clipW : 0;
        return { x: clipX * invW, y: clipY * invW, z: clipZ * invW, w: clipW };
    }
}
