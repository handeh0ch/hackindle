local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")

local Probe = WidgetContainer:extend{ name = "hackindle_p0", is_doc_only = true }

function Probe:init()
    self.ui.menu:registerToMainMenu(self)
end

function Probe:addToMainMenu(items)
    items.hackindle_p0 = {
        text = "Hackindle P0: capture synthetic observation",
        sorting_hint = "more_tools",
        callback = function() self:capture() end,
    }
end

local function call(obj, name, ...)
    if not obj or type(obj[name]) ~= "function" then return nil, "unsupported" end
    local ok, result = pcall(obj[name], obj, ...)
    if not ok then return nil, "error" end
    if result == nil then return nil, "nil" end
    return result, "ok"
end

function Probe:capture()
    local ok, message = pcall(function()
        local doc = self.ui.document
        local path = doc and doc.file
        -- Path plus exact fixture fingerprints prevent accidental use on another book.
        local expected = path and (path:match("/hackindle%-p0%-fixtures/(hackindle%-p0%.epub)$") or path:match("/hackindle%-p0%-fixtures/(hackindle%-p0%.pdf)$"))
        if not expected then error("Open the generated fixture in hackindle-p0-fixtures first.") end
        local f = assert(io.open(path, "rb"))
        local a, b, n = 1, 0, 0
        while true do
            local s = f:read(8192)
            if not s then break end
            n = n + #s
            for i = 1, #s do a = (a + s:byte(i)) % 65521; b = (b + a) % 65521 end
        end
        f:close()
        local fingerprints = { ["hackindle-p0.epub"] = { 10020, 701393183 }, ["hackindle-p0.pdf"] = { 1357, 417425435 } }
        if n ~= fingerprints[expected][1] or b * 65536 + a ~= fingerprints[expected][2] then
            error("Fixture fingerprint mismatch; regenerate and copy the matching package.")
        end
        local lines = { "fixture=" .. expected, "observed_unix=" .. os.time() }
        local function add(k, v) lines[#lines + 1] = k .. "=" .. tostring(v) end
        local page, ps
        if expected:match("%.pdf$") then
            page = self.ui.paging and self.ui.paging.current_page
            if type(page) == "number" and page > 0 then ps = "ok"
            else page, ps = nil, "unavailable" end
        else
            page, ps = call(doc, "getCurrentPage")
        end
        add("current_page_status", ps); add("current_page", page or "unavailable")
        local count, cs = call(doc, "getPageCount")
        add("page_count_status", cs); add("page_count", count or "unavailable")
        if expected:match("%.epub$") then
            local xp, xs = call(doc, "getXPointer")
            add("xpointer_status", xs); add("xpointer", xp or "unavailable")
            local nextpage, ns
            if page then nextpage, ns = call(doc, "getPageXPointer", page + 1) end
            add("next_page_xpointer_status", ns or "unavailable")
            if xp and nextpage then
                -- Extraction can clear engine selection; do not call when a selection is active.
                local h = self.ui.highlight
                if h and (h.hold_pos or h.selected_text) then
                    add("text_probe", "skipped_active_selection")
                else
                    local before = xp
                    local text, ts = call(doc, "getTextFromXPointers", xp, nextpage)
                    local after = call(doc, "getXPointer")
                    add("text_status", ts); add("text_bytes", type(text) == "string" and #text or "unavailable")
                    if type(text) == "string" then add("synthetic_text", text:gsub("\n", " ")) end
                    add("position_unchanged", before == after)
                    add("selection_restoration", "not tested; visual selection required")
                end
            end
        else
            if page and count then
                for p = math.max(1, page - 1), math.min(count, page + 1) do
                    local boxes, bs = call(doc, "getPageTextBoxes", p)
                    add("pdf_page_" .. p .. "_boxes_status", bs)
                    add("pdf_page_" .. p .. "_line_count", type(boxes) == "table" and #boxes or "unavailable")
                    if type(boxes) == "table" then
                        for li, line in ipairs(boxes) do
                            if type(line) == "table" then
                                for wi, word in ipairs(line) do
                                    if type(word) == "table" then
                                        add("box_" .. p .. "_" .. li .. "_" .. wi, string.format("%s,%s,%s,%s word:%s", tostring(word.x0), tostring(word.y0), tostring(word.x1), tostring(word.y1), tostring(word.word)))
                                    end
                                end
                            end
                        end
                    end
                end
                local area, as = call(self.ui.view, "getScreenPageArea", page)
                add("viewport_status", as)
                if type(area) == "table" then add("viewport", string.format("%s,%s,%s,%s", tostring(area.x), tostring(area.y), tostring(area.w), tostring(area.h))) end
                local w = call(Device.screen, "getWidth")
                local h = call(Device.screen, "getHeight")
                if type(area) == "table" and type(area.x) == "number" and type(area.y) == "number"
                    and type(area.w) == "number" and type(area.h) == "number"
                    and area.w > 0 and area.h > 0 and type(w) == "number" and type(h) == "number" then
                    local left = math.max(0, math.ceil(area.x))
                    local top = math.max(0, math.ceil(area.y))
                    local right = math.min(w - 1, math.ceil(area.x + area.w) - 1)
                    local bottom = math.min(h - 1, math.ceil(area.y + area.h) - 1)
                    if left <= right and top <= bottom then
                        for _, sample in ipairs({{"top_left", left, top}, {"bottom_right", right, bottom}}) do
                            local mapped, ms = call(self.ui.view, "screenToPageTransform", {x=sample[2], y=sample[3]})
                            add("sample_" .. sample[1], sample[2] .. "," .. sample[3])
                            add("transform_" .. sample[1] .. "_status", ms)
                            if type(mapped) == "table" then
                                add("transform_" .. sample[1], string.format("%s,%s,page:%s", tostring(mapped.x), tostring(mapped.y), tostring(mapped.page)))
                                add("transform_" .. sample[1] .. "_matches_page", mapped.page == page)
                            end
                        end
                    else add("transform_samples", "page area outside screen") end
                else add("transform_samples", "page area or screen size unavailable") end
                add("viewport_text_intersection", "not calculated; inspect geometry manually")
            end
        end
        -- Read only; no flush, no native database query, no independent timer.
        local stats = self.ui.statistics
        if stats and type(stats.page_stat) == "table" then
            add("native_current_page", stats.curr_page or "unavailable")
            local rows = stats.page_stat[stats.curr_page] or {}
            for _, tuple in ipairs(rows) do add("native_tuple", tostring(tuple[1]) .. "," .. tostring(tuple[2])) end
            add("native_min_sec", stats.settings and stats.settings.min_sec or "unavailable")
            add("native_max_sec", stats.settings and stats.settings.max_sec or "unavailable")
        else add("native_stats", "unavailable; record native statistics manually") end
        local out = assert(io.open(DataStorage:getSettingsDir() .. "/hackindle-p0-results.txt", "a"))
        out:write(table.concat(lines, "\n"), "\n---\n")
        out:close()
        return "Observation appended to settings/hackindle-p0-results.txt. This is not a pass."
    end)
    UIManager:show(InfoMessage:new{ text = ok and message or ("P0 diagnostic failed: " .. tostring(message)) })
end

return Probe
