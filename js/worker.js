// Web worker that runs OpenSCAD (compiled to WebAssembly) off the main
// thread. It receives an OpenSCAD source string and answers with a binary
// STL buffer, or with an error message that includes OpenSCAD's stderr.
//
// A fresh instance is created per render because the Emscripten main()
// cannot safely run twice on the same instance. The compiled module is
// cached by the loader, so repeat instantiations are cheap.

import OpenSCAD from "../vendor/openscad.js";

self.onmessage = async (event) => {
    const { id, source } = event.data;
    const stderr = [];
    try {
        const instance = await OpenSCAD({
            noInitialRun: true,
            print: () => {},
            printErr: (line) => stderr.push(line),
        });
        instance.FS.writeFile("/input.scad", source);
        instance.callMain([
            "/input.scad",
            "-o", "/out.stl",
            "--export-format=binstl",
        ]);
        const stl = instance.FS.readFile("/out.stl");
        self.postMessage({ id, stl: stl.buffer }, [stl.buffer]);
    } catch (err) {
        const detail = stderr.slice(-5).join("\n");
        self.postMessage({ id, error: `${err}\n${detail}`.trim() });
    }
};
