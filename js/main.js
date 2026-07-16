import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { GROUPS, defaults, scadSource } from "./params.js";

const statusEl = document.getElementById("status");
const downloadEl = document.getElementById("download");
const values = defaults();

// ---------------------------------------------------------------------
// Controls. Each parameter definition becomes a slider, checkbox, or
// dropdown; changing any of them schedules a re-render.

function buildControls() {
    const form = document.getElementById("controls");
    for (const group of GROUPS) {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = group.title;
        fieldset.append(legend);
        for (const param of group.params) {
            fieldset.append(buildControl(param));
        }
        form.append(fieldset);
    }
}

function buildControl(param) {
    const div = document.createElement("div");
    div.className = "control";
    const label = document.createElement("label");
    label.textContent = param.label;
    label.htmlFor = param.scad;
    div.append(label);

    if (param.type === "checkbox") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = param.scad;
        input.checked = param.value === 1;
        input.addEventListener("input", () => {
            values[param.scad] = input.checked ? 1 : 0;
            scheduleRender();
        });
        div.append(input);
        return div;
    }

    if (param.type === "select") {
        const select = document.createElement("select");
        select.id = param.scad;
        for (const option of param.options) {
            const el = document.createElement("option");
            el.value = option;
            el.textContent = option;
            el.selected = option === param.value;
            select.append(el);
        }
        select.addEventListener("input", () => {
            values[param.scad] = Number(select.value);
            scheduleRender();
        });
        div.append(select);
        return div;
    }

    const output = document.createElement("output");
    output.textContent = param.value;
    const input = document.createElement("input");
    input.type = "range";
    input.id = param.scad;
    input.min = param.min;
    input.max = param.max;
    input.step = param.step;
    input.value = param.value;
    input.addEventListener("input", () => {
        values[param.scad] = Number(input.value);
        output.textContent = input.value;
        scheduleRender();
    });
    div.append(output, input);
    return div;
}

// ---------------------------------------------------------------------
// Rendering pipeline. One render runs at a time; while it runs, further
// parameter changes only mark the state dirty, and the latest state is
// rendered as soon as the current render finishes.
//
// Each render gets a fresh worker because the Emscripten runtime cannot
// safely run main() twice on one instance. The wasm fetch is served from
// the browser cache, so respawning is cheap.

let busy = false;
let dirty = false;
let debounceTimer = null;
let renderId = 0;
let renderStart = 0;
let lastStl = null;

function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(startRender, 150);
}

function startRender() {
    if (busy) {
        dirty = true;
        return;
    }
    busy = true;
    dirty = false;
    renderId += 1;
    renderStart = performance.now();
    statusEl.textContent = "rendering…";

    const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
    });
    worker.onmessage = (event) => {
        worker.terminate();
        const { id, stl, error } = event.data;
        busy = false;
        if (id === renderId && stl) {
            const seconds =
                ((performance.now() - renderStart) / 1000).toFixed(1);
            lastStl = stl;
            downloadEl.disabled = false;
            showStl(stl);
            statusEl.textContent = `rendered in ${seconds} s`;
        } else if (id === renderId && error) {
            statusEl.textContent = `render failed: ${error}`;
            console.error(error);
        }
        if (dirty) {
            startRender();
        }
    };
    worker.onerror = (event) => {
        worker.terminate();
        busy = false;
        statusEl.textContent = `render failed: ${event.message}`;
        console.error(event);
    };
    worker.postMessage({ id: renderId, source: scadSource(values) });
}

downloadEl.addEventListener("click", () => {
    if (!lastStl) {
        return;
    }
    const blob = new Blob([lastStl], { type: "model/stl" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "twirly.stl";
    link.click();
    URL.revokeObjectURL(link.href);
});

// ---------------------------------------------------------------------
// Viewer. A WebGL failure must not take down the controls: without a
// viewer the model can still be rendered and downloaded as STL.

let viewer = null;

function initViewer() {
    const canvas = document.getElementById("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14151a);

    const camera = new THREE.PerspectiveCamera(40, 1, 1, 2000);
    camera.position.set(160, 90, 160);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xf0ead8, 0x40382c, 1.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(1, 2, 1.5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x8ba0c0, 0.7);
    rimLight.position.set(-2, -0.5, -1);
    scene.add(rimLight);

    const material = new THREE.MeshStandardMaterial({
        color: 0xf2e3cf,
        roughness: 0.55,
        metalness: 0.05,
    });

    function resize() {
        const { clientWidth: w, clientHeight: h } = canvas.parentElement;
        renderer.setSize(w, h, false);
        renderer.setPixelRatio(window.devicePixelRatio);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }

    window.addEventListener("resize", resize);
    resize();

    renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
    });

    return { scene, mesh: null, material, loader: new STLLoader() };
}

function showStl(buffer) {
    if (!viewer) {
        return;
    }
    const geometry = viewer.loader.parse(buffer);
    // The STL's z-up axis becomes three.js's y-up.
    geometry.rotateX(-Math.PI / 2);
    if (viewer.mesh) {
        viewer.mesh.geometry.dispose();
        viewer.mesh.geometry = geometry;
    } else {
        viewer.mesh = new THREE.Mesh(geometry, viewer.material);
        viewer.scene.add(viewer.mesh);
    }
}

// ---------------------------------------------------------------------

buildControls();
try {
    viewer = initViewer();
} catch (err) {
    console.error(err);
    statusEl.textContent = "WebGL unavailable: no preview, STL download " +
        "still works.";
}
startRender();
