local M = {}
-- Input must come from the device's cryptographically secure random source.
-- Availability and safety of that source remain unverified.
function M.uuid(bytes)
    assert(type(bytes) == "string" and #bytes == 16, "secure random bytes unavailable")
    local parts = {}
    for i = 1, 16 do
        local b = bytes:byte(i)
        if i == 7 then b = b % 16 + 64 end
        if i == 9 then b = b % 64 + 128 end
        parts[#parts + 1] = string.format("%02x", b)
    end
    return table.concat(parts, "", 1, 4) .. "-" .. table.concat(parts, "", 5, 6) .. "-"
        .. table.concat(parts, "", 7, 8) .. "-" .. table.concat(parts, "", 9, 10) .. "-"
        .. table.concat(parts, "", 11, 16)
end
-- The caller must hash all original file bytes with SHA-256; a native partial
-- digest, metadata, or a filename is not a source identity.
function M.source(digest)
    assert(type(digest) == "string" and #digest == 64 and digest:match("^[0-9a-f]+$"), "source SHA-256 unavailable")
    return digest
end
return M
