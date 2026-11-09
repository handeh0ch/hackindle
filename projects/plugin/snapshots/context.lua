-- extract reads a page without changing the reader position or selection.
-- That property and the page numbering remain device adapter assumptions.
local M = {}
function M.capture(extract, total, first, last, basis, origin, captured_at, null)
    assert(null ~= nil, "JSON null sentinel required")
    assert(first >= 1 and first <= last and last <= total, "invalid page range")
    assert(basis == "rendered" or basis == "original_pdf", "invalid page basis")
    assert(origin == "creation" or origin == "backfill", "invalid context origin")
    local function page(number)
        local ok, text = pcall(extract, number)
        if not ok or type(text) ~= "string" then return nil end
        return {number = number, text = text}
    end
    local before = first > 1 and page(first - 1) or nil
    local after = last < total and page(last + 1) or nil
    if (first > 1 and not before) or (last < total and not after) then
        return {status = "pending", reason = "page extraction unavailable"}
    end
    local selected = {}
    for n = first, last do
        local value = page(n)
        if not value then return {status = "pending", reason = "page extraction unavailable"} end
        selected[#selected + 1] = value
    end
    return {status = "ready", origin = origin, captured_at = captured_at, page_basis = basis,
        total_pages = total, before = before or null, selection_pages = selected, after = after or null}
end
return M
