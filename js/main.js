import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { GROUPS, PRESETS, defaults, scadSource } from "./params.js";

const statusEl = document.getElementById("status");
const downloadEl = document.getElementById("download");
const values = defaults();

// ---------------------------------------------------------------------
// Shareable URLs. Parameters that differ from their defaults are mirrored
// into the query string, so the current shape can be shared by copying
// the address.

function applyUrlParams() {
    const query = new URLSearchParams(location.search);
    for (const group of GROUPS) {
        for (const param of group.params) {
            if (!query.has(param.scad)) {
                continue;
            }
            const num = Number(query.get(param.scad));
            if (!Number.isFinite(num)) {
                continue;
            }
            if (param.min !== undefined) {
                values[param.scad] =
                    Math.min(param.max, Math.max(param.min, num));
            } else if (param.type === "select") {
                if (param.options.includes(num)) {
                    values[param.scad] = num;
                }
            } else {
                values[param.scad] = num ? 1 : 0;
            }
        }
    }
}

function updateUrl() {
    const defs = defaults();
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(values)) {
        if (value !== defs[name]) {
            query.set(name, value);
        }
    }
    const qs = query.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

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
        input.checked = values[param.scad] === 1;
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
            el.selected = option === values[param.scad];
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
    output.textContent = values[param.scad];
    const input = document.createElement("input");
    input.type = "range";
    input.id = param.scad;
    input.min = param.min;
    input.max = param.max;
    input.step = param.step;
    input.value = values[param.scad];
    input.addEventListener("input", () => {
        values[param.scad] = Number(input.value);
        output.textContent = input.value;
        syncTopControls();
        scheduleRender();
    });
    div.append(output, input);
    return div;
}

// With pointiness 0 the top stays open, so the tip-shape parameters have
// no effect; grey them out to signal that.
function syncTopControls() {
    const off = values.pointiness === 0;
    for (const id of ["roundness", "tip_fraction"]) {
        const input = document.getElementById(id);
        if (input) {
            input.disabled = off;
            input.closest(".control").classList.toggle("disabled", off);
        }
    }
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
    updateUrl();
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

document.getElementById("share").addEventListener("click", async () => {
    await navigator.clipboard.writeText(location.href);
    statusEl.textContent = "link copied";
});

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

    return {
        scene, camera, controls, mesh: null, material,
        loader: new STLLoader(), fitted: false,
    };
}

// Position the camera so the whole model fits the view, with a small
// margin. Fitting uses the smaller of the vertical and horizontal fields
// of view, so the model fits on narrow (mobile) screens too.
function fitCamera(geometry) {
    const { camera, controls } = viewer;
    geometry.computeBoundingSphere();
    const { center, radius } = geometry.boundingSphere;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = (1.15 * radius) / Math.sin(Math.min(vFov, hFov) / 2);
    const direction = new THREE.Vector3(1, 0.5, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, dist);
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
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
    // Fit once, on the first model of the page load; after that the
    // camera stays where the user put it.
    if (!viewer.fitted) {
        viewer.fitted = true;
        fitCamera(geometry);
    }
}

// ---------------------------------------------------------------------
// Mobile menu. On narrow screens the panel slides in from the left.

const panel = document.getElementById("panel");
document.getElementById("menu-toggle").addEventListener("click", () => {
    panel.classList.toggle("open");
});
document.getElementById("canvas").addEventListener("pointerdown", () => {
    panel.classList.remove("open");
});

// ---------------------------------------------------------------------

// Preset links navigate with a new query string, which reloads the page
// with those parameters applied; "reset" clears back to the defaults.
function buildPresets() {
    const nav = document.getElementById("presets");
    for (const preset of PRESETS) {
        const link = document.createElement("a");
        link.href = `?${preset.query}`;
        link.textContent = preset.name;
        nav.append(link);
    }
    const reset = document.createElement("a");
    reset.href = location.pathname;
    reset.textContent = "reset";
    reset.className = "reset";
    nav.append(reset);
}

applyUrlParams();
buildPresets();
buildControls();
syncTopControls();
try {
    viewer = initViewer();
} catch (err) {
    console.error(err);
    statusEl.textContent = "WebGL unavailable: no preview, STL download " +
        "still works.";
}
startRender();
