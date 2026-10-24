# GX10 vision scans

Four synthetic Northfield derivatives: 6° rotated JPEG photo, 72 DPI duplicate
scan, two-page PDF with the bank-change remittance on page 2, and an italic,
slightly skewed (handwritten-ish, not actual handwriting) total on the no-PO bill.
Three planted traps include the duplicate +$37, lookalike bank change with an
embedded approval instruction, and missing PO. Sources are never edited.

Original source PDFs lack stable vendor IDs and account references; the derivatives
add a **visible synthetic remittance addendum**. This makes the extraction task
complete without filling absent facts from an answer key or vendor master. Raw
unaugmented PDFs must still hold if those required facts are missing.

`manifest.json` freezes expected fields, sender metadata, rules and SHA-256s.
`python3 fixtures/vision/generate.py` needs PyMuPDF and ImageMagick. The benchmark
uses manifest expectations for scoring only, never model input. Runtime rasterization
uses the bundled PDFium and sharp dependencies, with no Python/CLI requirement.
