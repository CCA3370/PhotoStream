# Third-party notices

This directory redistributes a browser-only OCR runtime and fixed model artifacts. PhotoStream does
not claim ownership of the third-party components listed below.

| Component | Version/artifact | License | Upstream |
| --- | --- | --- | --- |
| PaddleOCR.js and PP-OCRv6 tiny models | `@paddleocr/paddleocr-js` 0.4.2 | Apache-2.0 | <https://github.com/PaddlePaddle/PaddleOCR> |
| OpenCV.js wrapper/runtime | `@techstark/opencv-js` 4.10.0-release.1 | Apache-2.0 | <https://github.com/TechStark/opencv-js> |
| ONNX Runtime Web | 1.24.3 | MIT | <https://github.com/microsoft/onnxruntime> |
| js-yaml | 4.1.1 in the worker; 4.3.1 in the main-thread bridge | MIT | <https://github.com/nodeca/js-yaml> |
| Clipper | 6.4.2 | BSL-1.0 | <https://github.com/junmer/clipper-lib> |
| JSBN subset embedded by Clipper | Copyright 2003-2005 Tom Wu | BSD-like notice | <https://github.com/creationix/jsbn> |

PhotoStream modifies the generated PaddleOCR distribution only to pin model/WASM URLs to this
same-origin, content-versioned directory, disable remote fallbacks, and expose the worker-only
creation bridge used by `apps/web/src/lib/bib-ocr.ts`. The model archives and ONNX Runtime WASM
binaries are otherwise copied byte-for-byte from the sources recorded in `manifest.json`.

The complete applicable license texts are included in this directory under `licenses/`.
