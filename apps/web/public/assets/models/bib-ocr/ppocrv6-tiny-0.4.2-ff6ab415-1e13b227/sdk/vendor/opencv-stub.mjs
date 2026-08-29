export default new Proxy({}, { get() { throw new Error("OpenCV is unavailable on the OCR main thread"); } });
