# twirly

A twisted vase generator that runs entirely in the browser. Sliders control
the shape parameters, [openscad-wasm](https://github.com/openscad/openscad-wasm)
renders the model in a web worker, and [three.js](https://threejs.org/)
displays the result. The generated STL can be downloaded for 3D printing.

Live site: https://juliaogris.github.io/twirly/

## How it works

The model is defined in [twirly.scad](twirly.scad), a single OpenSCAD
`polyhedron` whose wall radius is a function of height and angle. The same
program is embedded in [js/params.js](js/params.js), which also declares the
parameter ranges that become the UI controls. When a slider changes, the
parameter assignments are prepended to the program body and the source is
sent to a web worker ([js/worker.js](js/worker.js)) that runs the OpenSCAD
WebAssembly build and returns a binary STL. The main thread
([js/main.js](js/main.js)) parses the STL and shows it in a three.js scene.

There is no build step. The site is plain static files served by GitHub
Pages; three.js is loaded from a CDN and the OpenSCAD runtime is vendored
in [vendor/](vendor/).

## Development

Serve the directory with any static file server and open the page:

```sh
python3 -m http.server 8000
open http://localhost:8000
```

The shape can also be explored in the OpenSCAD desktop application by
opening `twirly.scad` and using the Customizer (Window > Customizer).

## Origin

The shape program is based on the twisted vase / candy bowl family of
parametric OpenSCAD designs, refactored for readability and extended with a
superellipse envelope that closes the top with a rounded or pointed tip.

## License

This repository is licensed under GPL-3.0 (see [LICENSE](LICENSE)) because
it distributes the OpenSCAD WebAssembly build, which is GPL-licensed.
