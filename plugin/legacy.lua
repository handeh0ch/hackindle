local state = require("state")
local M = {}
-- Legacy statistics stay separate from measured character and time events.
function M.snapshot(store, source, read, build_packet)
    assert(type(source) == "string" and #source == 64 and source:match("^[0-9a-f]+$"), "invalid source ID")
    local ok, records = pcall(read)
    if not ok or type(records) ~= "table" then return nil end
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local version = state.next_counter(tx, "legacy_version:" .. source)
        local seq = state.next_sequence(tx)
        local packet = build_packet(seq, {version = version, records = records})
        assert(type(packet) == "string", "packet encoding failed")
        tx:enqueue(seq, packet)
        return packet
    end)
end
-- Retain cumulative raw high-water marks so repeated resets subtract from raw,
-- not from the previous generation's already-subtracted live value.
function M.reconcile(data, records, reset)
    local seen = {}
    for _, record in ipairs(records) do
        assert(type(record.date) == "string" and not seen[record.date], "invalid legacy date")
        seen[record.date] = true
        for _, key in ipairs({"native_pages", "native_seconds"}) do
            local n = record[key]
            assert(type(n) == "number" and n >= 0 and n <= 9007199254740991 and n == math.floor(n), "invalid legacy counter")
        end
        local item = data[record.date] or {pages = 0, seconds = 0, baseline_pages = 0, baseline_seconds = 0}
        item.pages = math.max(item.pages, record.native_pages)
        item.seconds = math.max(item.seconds, record.native_seconds)
        data[record.date] = item
    end
    local dates = {}
    for date in pairs(data) do dates[#dates + 1] = date end
    table.sort(dates)
    local result = {}
    for _, date in ipairs(dates) do
        local item = data[date]
        if reset then item.baseline_pages, item.baseline_seconds = item.pages, item.seconds end
        result[#result + 1] = {date = date, native_pages = item.pages - item.baseline_pages,
            native_seconds = item.seconds - item.baseline_seconds}
    end
    return result
end
return M
