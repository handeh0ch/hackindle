local DataStorage = require("datastorage")
local Ranges = require("p0_ranges")
local util = require("util")
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
                    local function check(name, fn)
                        local success, detail = pcall(fn)
                        add("invariant_" .. name, success and "pass" or ("fail:" .. tostring(detail)))
                    end
                    check("utf8_scalars_v1", function()
                        assert(Ranges.count("A B") == 3)
                        assert(Ranges.count("Привет") == 6)
                        assert(Ranges.count("é") == 1)
                        assert(Ranges.count("é") == 2)
                        assert(not pcall(Ranges.count, string.char(0xC0, 0xAF)))
                    end)
                    local prefix = "/body/DocFragment/body/p[%d]/text().%d"
                    local a = string.format(prefix, 1, 0)
                    local b = string.format(prefix, 1, 10)
                    local c = string.format(prefix, 1, 20)
                    local d = string.format(prefix, 1, 30)
                    local p2 = string.format(prefix, 2, 0)
                    local far = string.format(prefix, 10, 0)
                    local far_end = string.format(prefix, 10, 10)
                    add("fixed_span_start", a); add("fixed_span_end", d)
                    local line1 = "Segment 001: alpha beta gamma delta synthetic reading fixture."
                    local function cmp(left, right)
                        local v, status = call(doc, "compareXPointers", left, right)
                        assert(status == "ok" and (v == -1 or v == 0 or v == 1), "compare unavailable or invalid")
                        return -v -- installed CRE: 1 means second pointer is later
                    end
                    local function extract(left, right)
                        local value, status = call(doc, "getTextFromXPointers", left, right)
                        assert(status == "ok" and type(value) == "string", "extraction unavailable")
                        return value
                    end
                    local function measure(left, right) return Ranges.count(extract(left, right)) end
                    check("cre_range_union", function()
                        assert(cmp(a, b) < 0 and cmp(b, a) > 0 and cmp(a, a) == 0, "comparator orientation")
                        assert(extract(a, d) == line1:sub(1, 30), "fixed 30-codepoint text mismatch")
                        local set = Ranges.new(cmp, measure)
                        local total, added = set:add(a, c); assert(total == 20 and added == 20, "first span")
                        total, added = set:add(b, d); assert(total == 30 and added == 10, "overlap")
                        total, added = set:add(a, d); assert(total == 30 and added == 0, "repeat")
                        assert(extract(far, far_end) == "Segment 01", "far span mismatch")
                        total, added = set:add(far, far_end); assert(total == 40 and added == 10, "jump/disjoint")
                        assert(#set.ranges == 2, "intervening range included")
                    end)
                    check("paragraph_delimiter", function()
                        assert(extract(a, p2) == line1 .. "\n", "expected one newline after paragraph")
                    end)
                    local final_position, final_status = call(doc, "getXPointer")
                    add("invariant_final_position_status", final_status)
                    add("invariant_final_position_unchanged", before == final_position)
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
                local view = self.ui.view
                local pages, list_status = call(view, "getCurrentPageList")
                add("visible_pages_status", list_status)
                local cfg = doc.configurable or {}
                add("pdf_scroll_mode", view.page_scroll)
                add("pdf_reflow_text_wrap", cfg.text_wrap)
                add("pdf_trim_page", cfg.trim_page)
                add("pdf_rotation", view.state and view.state.rotation)
                add("pdf_zoom", view.state and view.state.zoom)
                local w = call(Device.screen, "getWidth")
                local h = call(Device.screen, "getHeight")
                if type(pages) == "table" then
                    for _, visible_page in ipairs(pages) do
                        add("visible_page", visible_page)
                        local area, status = call(view, "getScreenPageArea", visible_page)
                        add("area_" .. tostring(visible_page) .. "_status", status)
                        if type(area) == "table" then
                            add("area_" .. tostring(visible_page), string.format("%s,%s,%s,%s", tostring(area.x), tostring(area.y), tostring(area.w), tostring(area.h)))
                        end
                        if type(area) == "table" and type(area.x) == "number" and type(area.y) == "number"
                            and type(area.w) == "number" and type(area.h) == "number"
                            and area.w > 0 and area.h > 0 and type(w) == "number" and type(h) == "number" then
                            local left = math.max(0, math.ceil(area.x))
                            local top = math.max(0, math.ceil(area.y))
                            local right = math.min(w - 1, math.ceil(area.x + area.w) - 1)
                            local bottom = math.min(h - 1, math.ceil(area.y + area.h) - 1)
                            if left <= right and top <= bottom then
                                local corners = {{"top_left", left, top}, {"top_right", right, top},
                                    {"bottom_left", left, bottom}, {"bottom_right", right, bottom}}
                                for _, sample in ipairs(corners) do
                                    local key = "page_" .. tostring(visible_page) .. "_" .. sample[1]
                                    local mapped, ms = call(view, "screenToPageTransform", {x=sample[2], y=sample[3]})
                                    add("sample_" .. key, sample[2] .. "," .. sample[3])
                                    add("transform_" .. key .. "_status", ms)
                                    if type(mapped) == "table" then
                                        add("transform_" .. key, string.format("%s,%s,page:%s", tostring(mapped.x), tostring(mapped.y), tostring(mapped.page)))
                                        add("transform_" .. key .. "_matches_page", mapped.page == visible_page)
                                    end
                                end
                            else add("area_" .. tostring(visible_page) .. "_samples", "outside screen") end
                        else add("area_" .. tostring(visible_page) .. "_samples", "geometry unavailable") end
                    end
                end
                add("viewport_text_intersection", "not calculated; inspect geometry manually")
            end
        end
        -- Read only; no flush, no native database query, no independent timer.
        local stats = self.ui.statistics
        local digest_ok, digest = pcall(util.partialMD5, path)
        if stats and stats.document == doc and stats.is_doc and stats.id_curr_book
            and digest_ok and digest and stats.doc_md5 == digest
            and type(stats.page_stat) == "table" then
            add("native_stats", "fixture identity matched; raw volatile observations")
            add("native_current_page", stats.curr_page or "unavailable")
            add("native_enabled", stats.settings and stats.settings.is_enabled)
            add("native_not_frozen", stats.is_doc_not_frozen)
            add("native_book_ready", stats.id_curr_book ~= nil)
            add("native_min_sec", stats.settings and stats.settings.min_sec or "unavailable")
            add("native_max_sec", stats.settings and stats.settings.max_sec or "unavailable")
            for p, rows in pairs(stats.page_stat) do
                if type(rows) == "table" then
                    for _, tuple in ipairs(rows) do
                        if type(tuple) == "table" then add("native_tuple", tostring(p) .. "," .. tostring(tuple[1]) .. "," .. tostring(tuple[2])) end
                    end
                end
            end
        else add("native_stats", "unavailable or fixture identity mismatch; no tuples read") end
        local out = assert(io.open(DataStorage:getSettingsDir() .. "/hackindle-p0-results.txt", "a"))
        out:write(table.concat(lines, "\n"), "\n---\n")
        out:close()
        return "Observation appended to settings/hackindle-p0-results.txt. This is not a pass."
    end)
    UIManager:show(InfoMessage:new{ text = ok and message or ("P0 diagnostic failed: " .. tostring(message)) })
end

return Probe
