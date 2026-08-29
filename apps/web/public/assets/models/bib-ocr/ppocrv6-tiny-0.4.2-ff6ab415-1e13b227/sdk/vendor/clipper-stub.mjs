export default new Proxy({}, { get() { throw new Error("Clipper is unavailable on the OCR main thread"); } });
