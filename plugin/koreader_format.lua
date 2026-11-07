-- Verifies the document format from file content, not only from the extension.
local M = {}
local EXTENSIONS = {epub = "epub", pdf = "pdf", mobi = "mobi", azw = "mobi", azw3 = "mobi", prc = "mobi"}

function M.resolve(ui, open)
    open = open or io.open
    local path = type(ui) == "table" and type(ui.document) == "table" and ui.document.file
    if type(path) ~= "string" then return {verified = false} end
    local extension = path:match("%.([%w]+)$")
    local format = extension and EXTENSIONS[extension:lower()]
    if not format then return {verified = false} end
    local handle = open(path, "rb")
    if not handle then return {verified = false} end
    local ok, head = pcall(function() return handle:read(68) end)
    pcall(function() handle:close() end)
    if not ok or type(head) ~= "string" then return {verified = false} end
    local matches = (format == "pdf" and head:sub(1, 5) == "%PDF-")
        or (format == "epub" and head:sub(1, 4) == "PK\3\4")
        or (format == "mobi" and head:sub(61, 68) == "BOOKMOBI")
    return matches and {verified = true, format = format} or {verified = false}
end
return M
