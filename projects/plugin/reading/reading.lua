-- Locator comparison and extraction are supplied by the unverified device adapter.
local M = {}

function M.count(s)
    assert(type(s) == "string", "text unavailable")
    local i, count = 1, 0
    while i <= #s do
        local a = s:byte(i)
        local n = a < 0x80 and 1 or (a >= 0xC2 and a <= 0xDF and 2)
            or (a >= 0xE0 and a <= 0xEF and 3)
            or (a >= 0xF0 and a <= 0xF4 and 4)
        assert(n and i + n - 1 <= #s, "invalid UTF-8")
        for j = 1, n - 1 do
            local b = s:byte(i + j)
            assert(b >= 0x80 and b <= 0xBF, "invalid UTF-8 continuation")
        end
        local b = n > 1 and s:byte(i + 1)
        assert(not (n == 3 and ((a == 0xE0 and b < 0xA0) or (a == 0xED and b >= 0xA0)))
            and not (n == 4 and ((a == 0xF0 and b < 0x90) or (a == 0xF4 and b >= 0x90))),
            "invalid Unicode scalar")
        i, count = i + n, count + 1
    end
    return count
end



function M.new(compare, measure, days)
    local ledger = { days = days or {} }
    function ledger:credit(source, day, first, last)
        assert(compare(first, last) < 0, "invalid range")
        self.days[source] = self.days[source] or {}
        local ranges = self.days[source][day] or {}
        local pieces, cursor = {}, first
        for _, range in ipairs(ranges) do
            if compare(range.last, cursor) > 0 and compare(range.first, last) < 0 then
                if compare(range.first, cursor) > 0 then
                    pieces[#pieces + 1] = {first = cursor, last = range.first}
                end
                if compare(range.last, cursor) > 0 then cursor = range.last end
                if compare(cursor, last) >= 0 then break end
            end
        end
        if compare(cursor, last) < 0 then pieces[#pieces + 1] = {first = cursor, last = last} end
        for _, piece in ipairs(pieces) do
            piece.characters = measure(piece.first, piece.last)
            assert(type(piece.characters) == "number" and piece.characters >= 0
                and piece.characters <= 9007199254740991 and piece.characters == math.floor(piece.characters), "invalid measure")
        end
        local merged, inserted = {}, false
        for _, range in ipairs(ranges) do
            if compare(range.last, first) < 0 then
                merged[#merged + 1] = range
            elseif compare(last, range.first) < 0 then
                if not inserted then merged[#merged + 1] = {first = first, last = last}; inserted = true end
                merged[#merged + 1] = range
            else
                if compare(range.first, first) < 0 then first = range.first end
                if compare(range.last, last) > 0 then last = range.last end
            end
        end
        if not inserted then merged[#merged + 1] = {first = first, last = last} end
        self.days[source][day] = merged
        return pieces
    end
    return ledger
end
return M
