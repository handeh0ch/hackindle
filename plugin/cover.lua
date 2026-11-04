local M = {}
-- The adapter must extract and reduce an image locally without returning the
-- document bytes. Its image APIs and resizing behavior are unverified on device.
function M.prepare(extract_reduced)
    local ok, bytes = pcall(extract_reduced)
    if not ok or type(bytes) ~= "string" or #bytes > 65536 then return nil end
    if bytes:sub(1, 3) == "\255\216\255" then return bytes, "image/jpeg" end
    if bytes:sub(1, 4) == "RIFF" and bytes:sub(9, 12) == "WEBP" then return bytes, "image/webp" end
    return nil
end
return M
