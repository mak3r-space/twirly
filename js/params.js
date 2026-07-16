// Parameter definitions and the OpenSCAD program template.
//
// Each parameter renders as one UI control. The `scad` name must match the
// variable name used in the OpenSCAD body below; scadSource() prepends one
// assignment line per parameter.

export const GROUPS = [
    {
        title: "Size",
        params: [
            { scad: "height", label: "height", min: 30, max: 180, step: 5, value: 90 },
            { scad: "base_diameter", label: "base diameter", min: 40, max: 160, step: 5, value: 100 },
        ],
    },
    {
        title: "Silhouette",
        params: [
            { scad: "is_vase", label: "vase (waisted)", type: "checkbox", value: 0 },
            { scad: "profile_part", label: "profile arc", min: 0.3, max: 1.0, step: 0.05, value: 1 },
            { scad: "profile_depth", label: "bulge depth", min: 0, max: 0.9, step: 0.05, value: 0.6 },
        ],
    },
    {
        title: "Ribs",
        params: [
            { scad: "rib_count", label: "rib count", min: 0, max: 30, step: 1, value: 10 },
            { scad: "rib_depth", label: "rib depth", min: 0, max: 0.4, step: 0.01, value: 0.06 },
        ],
    },
    {
        title: "Twist",
        params: [
            { scad: "twist", label: "twist angle", min: 0, max: 360, step: 5, value: 90 },
            { scad: "twist_part", label: "twist arc (0 = linear)", min: 0, max: 3, step: 0.25, value: 1.5 },
        ],
    },
    {
        title: "Top",
        params: [
            { scad: "roundness", label: "roundness", min: 0.5, max: 8, step: 0.5, value: 4 },
            { scad: "pointiness", label: "pointiness (0 = open top)", min: 0, max: 10, step: 0.5, value: 1 },
            { scad: "tip_fraction", label: "tip size", min: 0.005, max: 0.2, step: 0.005, value: 0.02 },
        ],
    },
    {
        title: "Quality",
        params: [
            {
                scad: "accuracy", label: "detail (mm)", type: "select",
                options: [0.5, 1, 2, 3, 5], value: 2,
            },
        ],
    },
];

export function defaults() {
    const values = {};
    for (const group of GROUPS) {
        for (const param of group.params) {
            values[param.scad] = param.value;
        }
    }
    return values;
}

// The program body. Parameters are prepended by scadSource(), everything
// else matches the standalone twirly.scad in the repo root.
const BODY = `
base_r      = base_diameter / 2;
profile_arc = ((is_vase == 1) ? 1 : 0) + profile_part;

// Silhouette: the base radius plus a sine bulge over the height.
function profile_radius(z) =
    base_r + sin(profile_arc * 180 * z / height) * profile_depth * base_r;

// Ribs: a sine wave around the circumference.
function rib_offset(angle) = sin(angle * rib_count) * rib_depth * base_r;

// Twist: the angle by which the ribs have rotated at height z.
function twist_angle(z) =
    ((twist_part == 0) ? 1 : sin(twist_part * 180 * z / height))
    * twist * z / height;

// Top envelope: 1 at the base, falling to almost 0 at the top along a
// superellipse, which closes the shape.
function top_envelope(z) =
    max(tip_fraction, pow(1 - pow(z / height, roundness),
                          pointiness / roundness));

// Final wall radius at height z and direction angle.
function radius(z, angle) =
    (profile_radius(z) + rib_offset(angle + twist_angle(z))) * top_envelope(z);

// Mesh construction. Vertices are laid out ring by ring from bottom to
// top; vertex i of layer l has index l * segments + i.

layers    = floor(height / accuracy);
segments  = floor(360 / accuracy);
seg_angle = 360 / segments;

// Index of vertex i in a given layer; i wraps around the ring.
function idx(layer, i) = layer * segments + (i % segments);

module shape() {
    // Integer loop variables avoid float accumulation, which could change
    // the point count and silently break the face indices.
    points = [
        for (layer = [0 : layers], i = [0 : segments - 1])
            let (z = layer * height / layers, angle = i * seg_angle)
            [sin(angle) * radius(z, angle), cos(angle) * radius(z, angle), z]
    ];

    // Each grid cell between neighbouring rings splits into two triangles.
    side = [
        for (layer = [0 : layers - 1], i = [0 : segments - 1], t = [0 : 1])
            (t == 0)
                ? [idx(layer, i), idx(layer, i + 1),     idx(layer + 1, i + 1)]
                : [idx(layer, i), idx(layer + 1, i + 1), idx(layer + 1, i)]
    ];

    bottom = [for (i = [0 : segments - 1]) i];
    top    = [for (i = [idx(layers, 0) : idx(layers, segments - 1)]) i];

    polyhedron(points = points, faces = concat([bottom], [top], side));
}

translate([0, 0, -height / 2])
    shape();
`;

export function scadSource(values) {
    const assignments = Object.entries(values)
        .map(([name, value]) => `${name} = ${value};`)
        .join("\n");
    return assignments + "\n" + BODY;
}
