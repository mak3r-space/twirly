// Twisted vase / candy bowl, built as one polyhedron.
//
// The wall is defined in cylindrical coordinates: radius(z, angle) gives
// the distance from the axis at every height and direction. It combines a
// vertical silhouette, sinusoidal ribs, a twist that rotates the ribs with
// height, and an envelope that closes the top with a rounded tip.
//
// This file is the standalone version of the program embedded in
// js/params.js. If you change one, change the other.

/* [Quality] */
// Layer and segment size in mm.
accuracy = 1; // [0.5, 1, 2, 3, 5]

/* [Size] */
height        = 90;  // [30:5:180]
base_diameter = 100; // [40:5:160]

/* [Silhouette] */
// Set to 1 for a vase (wall curves back in near the top), 0 for a bowl.
is_vase = 0; // [0, 1]
// How much of the sine arc the silhouette uses (0.3 - 1.0). Vase mode adds
// 1 so the arc continues into its inward-curving half.
profile_part = 1; // [0.3:0.05:1]
// Depth of the silhouette bulge as a fraction of the base radius (< 1.0).
profile_depth = 0.6; // [0:0.05:0.9]

/* [Ribs] */
// Number of ribs around the circumference.
rib_count = 10; // [0:1:30]
// Depth of the ribs as a fraction of the base radius (< 0.5).
rib_depth = 0.06; // [0:0.01:0.4]

/* [Twist] */
// Total twist in degrees from bottom to top.
twist = 90; // [0:5:360]
// Shape of the twist over height: 0 twists linearly, otherwise the twist
// follows this part of a sinusoid (e.g. 1.5).
twist_part = 1.5; // [0:0.25:3]

/* [Top rounding] */
// How the top closes: 2 gives a full dome, 4 - 6 keep the body shape and
// round off only the tip.
roundness = 4; // [0.5:0.5:8]
// Tip sharpness: 1 = rounded, equal to roundness = straight cone tip,
// higher = sharp spike.
pointiness = 1; // [1:0.5:10]
// Radius of the very tip as a fraction of the base radius. Keep it above
// zero so the top ring of vertices does not collapse into a single point.
tip_fraction = 0.02; // [0.005:0.005:0.2]

// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
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
