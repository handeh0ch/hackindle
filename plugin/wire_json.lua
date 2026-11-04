local reading = require("reading")
local M = {null = {}}
local array_mt = {}
function M.array(value) return setmetatable(value, array_mt) end
function M.is_array(value) return type(value) == "table" and getmetatable(value) == array_mt end
local escapes = {['"']='\\"', ['\\']='\\\\', ['\b']='\\b', ['\f']='\\f', ['\n']='\\n', ['\r']='\\r', ['\t']='\\t'}
local function quote(value)
    reading.count(value)
    return '"' .. value:gsub('[%z\1-\31\\"]', function(c) return escapes[c] or string.format('\\u%04x', c:byte()) end) .. '"'
end
local function encode(value, seen)
    if value == M.null then return "null" end
    local kind = type(value)
    if kind == "string" then return quote(value) end
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "number" then
        assert(value == value and value ~= math.huge and value ~= -math.huge, "nonfinite JSON number")
        return string.format("%.17g", value)
    end
    assert(kind == "table" and not seen[value], "invalid JSON value")
    seen[value] = true
    local parts = {}
    if getmetatable(value) == array_mt then
        local count = 0
        for k in pairs(value) do
            assert(type(k) == "number" and k >= 1 and k == math.floor(k), "invalid array index")
            count = count + 1
        end
        assert(count == #value, "sparse array")
        for i = 1, count do parts[i] = encode(value[i], seen) end
        seen[value] = nil
        return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for k in pairs(value) do assert(type(k) == "string", "invalid object key"); keys[#keys + 1] = k end
    table.sort(keys)
    for _, k in ipairs(keys) do parts[#parts + 1] = quote(k) .. ":" .. encode(value[k], seen) end
    seen[value] = nil
    return "{" .. table.concat(parts, ",") .. "}"
end
function M.encode(value) return encode(value, {}) end
return M
