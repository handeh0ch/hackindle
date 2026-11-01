import pathlib, zipfile

OUT = pathlib.Path(__file__).parent / "generated" / "hackindle-p0-fixtures"
OUT.mkdir(parents=True, exist_ok=True)

def epub():
    sections = "".join(f"<p>Segment {i:03d}: alpha beta gamma delta synthetic reading fixture.</p>" for i in range(1, 121))
    files = {
        "META-INF/container.xml": '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        "book.opf": '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Hackindle P0 synthetic</dc:title><dc:identifier id="id">hackindle-p0</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="toc"><itemref idref="body"/></spine></package>',
        "toc.ncx": '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="hackindle-p0"/></head><docTitle><text>Hackindle P0 synthetic</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>Start</text></navLabel><content src="body.xhtml"/></navPoint></navMap></ncx>',
        "body.xhtml": '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Hackindle P0 synthetic</title></head><body>' + sections + '</body></html>',
    }
    with zipfile.ZipFile(OUT / "hackindle-p0.epub", "w") as z:
        for name, content in [("mimetype", "application/epub+zip"), *files.items()]:
            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, content.encode("utf-8"))

def pdf():
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    for page in range(1, 4):
        stream = f"BT /F1 18 Tf 40 740 Td (Synthetic page {page}) Tj 0 -40 Td (LEFT {page} alpha beta gamma) Tj 270 0 Td (RIGHT {page} delta epsilon) Tj ET".encode("ascii")
        objects += [f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + (page-1)*2} 0 R >>".encode(), b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"]
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    (OUT / "hackindle-p0.pdf").write_bytes(data)

epub()
pdf()
print(OUT)
