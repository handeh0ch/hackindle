from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile, ZIP_STORED
import runpy, xml.etree.ElementTree as ET

root = Path(__file__).parent
runpy.run_path(str(root / "generate.py"))
fixtures = root / "generated" / "hackindle-p0-fixtures"
first = {p.name: sha256(p.read_bytes()).hexdigest() for p in fixtures.iterdir()}
runpy.run_path(str(root / "generate.py"))
assert first == {p.name: sha256(p.read_bytes()).hexdigest() for p in fixtures.iterdir()}
with ZipFile(fixtures / "hackindle-p0.epub") as z:
    assert z.namelist()[0] == "mimetype"
    assert z.getinfo("mimetype").compress_type == ZIP_STORED
    assert z.read("mimetype") == b"application/epub+zip"
    for name in ("META-INF/container.xml", "book.opf", "toc.ncx", "body.xhtml"):
        ET.fromstring(z.read(name))
pdf = (fixtures / "hackindle-p0.pdf").read_bytes()
assert pdf.startswith(b"%PDF-1.4") and pdf.endswith(b"%%EOF\n")
assert pdf.count(b"/Type /Page ") == 3
for i in range(1, 4):
    assert f"Synthetic page {i}".encode() in pdf
package = root / "generated" / "hackindle-p0-package.zip"
with ZipFile(package, "w", ZIP_STORED) as z:
    for p in sorted((root / "hackindle-p0.koplugin").glob("*.lua")):
        z.write(p, "hackindle-p0.koplugin/" + p.name)
    for p in sorted(fixtures.iterdir()):
        z.write(p, "hackindle-p0-fixtures/" + p.name)
with ZipFile(package) as z:
    assert sorted(z.namelist()) == ["hackindle-p0-fixtures/hackindle-p0.epub", "hackindle-p0-fixtures/hackindle-p0.pdf", "hackindle-p0.koplugin/_meta.lua", "hackindle-p0.koplugin/main.lua"]
print("PASS: deterministic fixtures, EPUB XML/container, PDF structure, package allowlist")
