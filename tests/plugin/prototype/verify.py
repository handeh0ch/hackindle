from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile, ZIP_STORED
import re, runpy, zlib, xml.etree.ElementTree as ET

root = Path(__file__).parent
runpy.run_path(str(root / "generate.py"))
fixtures = root / "generated" / "hackindle-p0-fixtures"
first = {p.name: sha256(p.read_bytes()).hexdigest() for p in fixtures.iterdir()}
runpy.run_path(str(root / "generate.py"))
assert first == {p.name: sha256(p.read_bytes()).hexdigest() for p in fixtures.iterdir()}
with ZipFile(fixtures / "hackindle-p0.epub") as z:
    assert all(info.create_system == 0 and info.external_attr == 0x1800000 for info in z.infolist())
    assert z.namelist()[0] == "mimetype"
    assert z.getinfo("mimetype").compress_type == ZIP_STORED
    assert z.read("mimetype") == b"application/epub+zip"
    for name in ("META-INF/container.xml", "book.opf", "toc.ncx", "body.xhtml"):
        ET.fromstring(z.read(name))
source = (root / "hackindle-p0.koplugin" / "main.lua").read_text(encoding="utf-8")
assert 'self.ui.paging.current_page' in source
assert 'math.ceil(area.x + area.w) - 1' in source
assert 'math.ceil(area.y + area.h) - 1' in source
assert 'mapped.page == page' in source
assert '{"top_left", left, top}' in source and '{"bottom_right", right, bottom}' in source
assert 'page, ps = call(doc, "getCurrentPage")' in source
for field in ("word.x0", "word.y0", "word.x1", "word.y1", "word.word",
              "area.x", "area.y", "area.w", "area.h", "mapped.x", "mapped.y", "mapped.page"):
    assert "tostring(" + field + ")" in source
def check_fingerprints(lua, files):
    for name in ("hackindle-p0.epub", "hackindle-p0.pdf"):
        match = re.search(r'\["' + re.escape(name) + r'"\]\s*=\s*\{\s*(\d+)\s*,\s*(\d+)\s*\}', lua)
        assert match, "missing Lua fingerprint for " + name
        data = files[name]
        assert (len(data), zlib.adler32(data)) == tuple(map(int, match.groups())), name
fixture_bytes = {name: (fixtures / name).read_bytes() for name in ("hackindle-p0.epub", "hackindle-p0.pdf")}
check_fingerprints(source, fixture_bytes)
for name in fixture_bytes:
    corrupt = dict(fixture_bytes)
    corrupt[name] += b"x"
    try:
        check_fingerprints(source, corrupt)
    except AssertionError:
        pass
    else:
        raise AssertionError("fingerprint mismatch was not detected for " + name)
pdf = fixture_bytes["hackindle-p0.pdf"]
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
    packaged_lua = z.read("hackindle-p0.koplugin/main.lua").decode("utf-8")
    packaged_fixtures = {name: z.read("hackindle-p0-fixtures/" + name) for name in fixture_bytes}
    check_fingerprints(packaged_lua, packaged_fixtures)
    assert sorted(z.namelist()) == ["hackindle-p0-fixtures/hackindle-p0.epub", "hackindle-p0-fixtures/hackindle-p0.pdf", "hackindle-p0.koplugin/_meta.lua", "hackindle-p0.koplugin/main.lua"]
print("PASS: deterministic fixtures, ZIP metadata, EPUB XML/container, PDF structure, Lua fingerprint and source contracts, package allowlist")
