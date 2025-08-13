import * as three from 'three';
import { vector3ToLatLon } from './helpers.js';
import globeTexture from '../data/earth-texture.png';

export class Globe {

    constructor(scene, camera, spherical, requestRender) {
        this.scene = scene;
        this.camera = camera;
        this.cameraSphere = spherical;
        this.requestRender = requestRender;
        this.earthMesh = null;
    }

    createGlobe(container) {
        const earthGeo = new three.SphereGeometry(1, 24, 24);
        this.renderer = new three.WebGLRenderer({ alpha: true });

        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(this.renderer.domElement);

        this.camera.position.setFromSpherical(this.cameraSphere);
        this.camera.lookAt(0, 0, 0);

        new three.TextureLoader().load(globeTexture, texture => {
            texture.magFilter = three.NearestFilter;
            const earthMat = new three.MeshBasicMaterial({
                map: texture,
            });
            this.earthMesh = new three.Mesh(earthGeo, earthMat);
            this.scene.add(this.earthMesh);

            const outlineMat = new three.MeshBasicMaterial({
                side: three.BackSide,
            });
            const outline = new three.Mesh(earthGeo, outlineMat);

            outline.scale.set(1.002, 1.002, 1.002);
            this.scene.add(outline);
            this.requestRender();
        });
    }

    resizeCanvas(container) {
        if (!this.renderer) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }

    latLonFromScreenPos(x, y, boundaries) {
        const ndc = new three.Vector2(
            ((x - boundaries.left) / boundaries.width) * 2 - 1,
            -((y - boundaries.top) / boundaries.height) * 2 + 1
        );

        const raycaster = new three.Raycaster();
        raycaster.setFromCamera(ndc, this.camera);
        const hit = raycaster.intersectObject(this.earthMesh, false)[0];

        if (!hit) {
            console.info('Clicked outside globe');
            return;
        }

        const { lat, lon } = vector3ToLatLon(hit.point, 1);
        return { lat, lon };
    }

    rotate(dx, dy, dragSpeed) {
        this.cameraSphere.theta -= dx * dragSpeed;
        this.cameraSphere.phi = Math.max(
            0.05,
            Math.min(Math.PI - 0.1, this.cameraSphere.phi - dy * dragSpeed)
        );
        this.camera.position.setFromSpherical(this.cameraSphere);
        this.camera.lookAt(0, 0, 0);
        this.requestRender();
    }
}