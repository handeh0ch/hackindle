-- Version 1: count Unicode scalar values, including all spaces and combining marks.
-- No normalization; reject malformed UTF-8.
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

-- Comparator returns negative/zero/positive for before/equal/after.
-- Measures half-open ranges; caller must establish stable, additive extraction.
function M.new(compare, measure)
    local set = { ranges = {}, total = 0 }
    function set:add(first, last)
        assert(compare(first, last) < 0, "invalid range")
        local merged, inserted = {}, false
        for _, r in ipairs(self.ranges) do
            if compare(r[2], first) < 0 then
                merged[#merged + 1] = r
            elseif compare(last, r[1]) < 0 then
                if not inserted then merged[#merged + 1] = {first, last}; inserted = true end
                merged[#merged + 1] = r
            else
                if compare(r[1], first) < 0 then first = r[1] end
                if compare(r[2], last) > 0 then last = r[2] end
            end
        end
        if not inserted then merged[#merged + 1] = {first, last} end
        local total = 0
        for _, r in ipairs(merged) do total = total + measure(r[1], r[2]) end
        local added = total - self.total
        assert(added >= 0, "non-additive measure")
        self.ranges, self.total = merged, total
        return total, added
    end
    return set
end
return M
