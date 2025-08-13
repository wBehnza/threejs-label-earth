import { latLonToVector3 } from './helpers.js';
import labels from '../data/labels.json';
import * as THREE from 'three';

export class Labels {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.camera = camera;
        this.canvasLabels = [];

        this.ctx = this.canvas.getContext('2d');
        this.tmpV = new THREE.Vector3();
        this.mvp = new THREE.Matrix4();
        this.viewMatrix = new THREE.Matrix4();
        this.projMatrix = new THREE.Matrix4();
        this.camDir = new THREE.Vector3();
        this.frustum = new THREE.Frustum();
        this.tmpPos = new THREE.Vector3();     // world position
        this.tmpDelta = new THREE.Vector3();   // camera->point

        this.fontSize = 14;
        this.font = `${this.fontSize}px sans-serif`;
        this.padX = 3; this.padTop = 5; this.padBottom = 4;
        this.textMetricsCache = new Map();
    }

    setupLabelCanvas(container) {
        const dpr = window.devicePixelRatio || 1;
        const w = container.clientWidth, h = container.clientHeight;
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw() {
        const ctx = this.ctx;
        const cw = this.canvas.width / (window.devicePixelRatio || 1);
        const ch = this.canvas.height / (window.devicePixelRatio || 1);

        ctx.clearRect(0, 0, cw, ch);
        this.canvasLabels = [];

        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.lineWidth = 1;

        this.prepareCulling();

        const bgFill = 'black';
        const stroke = '#ff4d00';
        const textFill = 'white';

        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            const text = label.name;
            if (!text) continue;

            const worldPos = this.tmpPos.copy(latLonToVector3(label.lat, label.lon));

            if (this.camera.position.dot(worldPos) < 1) continue; // don't draw behind the globe

            const camToPoint = this.tmpDelta.copy(worldPos).sub(this.camera.position);
            if (this.camDir.dot(camToPoint) <= 0) continue;
            if (!this.frustum.containsPoint(worldPos)) continue;

            const ndcMargin = 0.02; // allow labels to be slightly outside viewport
            const ndc = this.toNDC(worldPos);
            if (ndc.x < -1 - ndcMargin || ndc.x > 1 + ndcMargin ||
                ndc.y < -1 - ndcMargin || ndc.y > 1 + ndcMargin ||
                ndc.w <= 0) continue;

            const px = (ndc.x + 1) * 0.5 * cw;
            const py = (1 - ndc.y) * 0.5 * ch;

            const m = this.measure(text);
            const boxW = m.width + this.padX * 2;
            const boxH = m.height;
            const bx = px - boxW / 2;
            const by = py - boxH;

            if (bx + boxW < 0 || bx > cw || by + boxH < 0 || by > ch) continue;

            ctx.fillStyle = bgFill;
            ctx.fillRect(bx, by, boxW, boxH);
            ctx.strokeStyle = stroke;
            ctx.strokeRect(bx, by, boxW, boxH);
            ctx.fillStyle = textFill;
            const textY = by + this.padTop + m.ascent;
            ctx.fillText(text, px, textY);

            this.canvasLabels.push({
                lat: label.lat,
                lon: label.lon,
                name: label.name,
                description: label.description,
                rect: { x: bx, y: by, width: boxW, height: boxH }
            });
        }
    }

    measure(text) {
        let m = this.textMetricsCache.get(text);
        if (m) return m;
        this.ctx.font = this.font;
        const mt = this.ctx.measureText(text);
        const ascent = (mt.actualBoundingBoxAscent ?? Math.ceil(this.fontSize * 0.8));
        const descent = (mt.actualBoundingBoxDescent ?? Math.ceil(this.fontSize * 0.2));
        m = { width: mt.width, ascent, descent, height: ascent + descent + this.padTop + this.padBottom };
        this.textMetricsCache.set(text, m);
        return m;
    }

    prepareCulling() {
        this.viewMatrix.copy(this.camera.matrixWorldInverse);
        this.projMatrix.copy(this.camera.projectionMatrix);
        this.mvp.multiplyMatrices(this.projMatrix, this.viewMatrix);
        this.frustum.setFromProjectionMatrix(this.mvp);
        this.camera.getWorldDirection(this.camDir); // forward vector
    }

    // Convert a 3D vector to Normalized Device Coordinates (NDC)
    toNDC(vec) {
        const x = vec.x, y = vec.y, z = vec.z;
        const e = this.mvp.elements;
        const nx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const ny = e[1] * x + e[5] * y + e[9] * z + e[13];
        const nz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const nw = e[3] * x + e[7] * y + e[11] * z + e[15];
        const iw = nw !== 0 ? 1 / nw : 0;
        return { x: nx * iw, y: ny * iw, z: nz * iw, w: nw };
    }

    getLabelAtMousePos(e, boundaries) {
        const x = e.x - boundaries.left;
        const y = e.y - boundaries.top;

        for (let i = this.canvasLabels.length - 1; i >= 0; i--) {
            const r = this.canvasLabels[i].rect;
            if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
                return this.canvasLabels[i];
            }
        }
    }
}
