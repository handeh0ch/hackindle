package.path = "projects/plugin/?.lua;" .. package.path
local context = require("snapshots.context")
local null = {}
local pages = {"first", "", "footnote", "last"}
local function extract(n) return pages[n] end
local c = context.capture(extract, 4, 1, 2, "rendered", "creation", "2026-01-01T00:00:00Z", null)
assert(c.status == "ready" and c.before == null and c.selection_pages[2].text == "" and c.after.text == "footnote")
c = context.capture(extract, 4, 3, 4, "original_pdf", "backfill", "2026-01-01T00:00:00Z", null)
assert(c.before.text == "" and c.after == null and c.page_basis == "original_pdf" and c.origin == "backfill")
c = context.capture(function() return nil end, 4, 1, 1, "rendered", "creation", "2026-01-01T00:00:00Z", null)
assert(c.status == "pending" and #c.reason > 0)
assert(not pcall(function() context.capture(extract, 4, 4, 3, "rendered", "creation", "2026-01-01T00:00:00Z", null) end))
print("context assertions passed")
c = context.capture(extract, 4, 1, 4, "original_pdf", "creation", "2026-01-01T00:00:00Z", null)
assert(c.before == null and c.after == null)
assert(not pcall(function() context.capture(extract, 4, 1, 1, "rendered", "creation", "2026-01-01T00:00:00Z") end))
