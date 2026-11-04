local json = require("wire_json")
local reading = require("reading")
local M = {}
local function copy(value, seen, depth)
    assert(depth <= 128, "JSON state nesting too deep")
    if type(value) == "number" then assert(value == value and math.abs(value) <= 9007199254740991, "JSON number out of range") end
    if value == json.null or type(value) ~= "table" then return value end
    assert(not seen[value], "cyclic state")
    seen[value] = true
    local array = json.is_array(value)
    for k in pairs(value) do if type(k) == "number" then array = true end end
    local result = array and json.array({}) or {}
    for k, v in pairs(value) do result[k] = copy(v, seen, depth + 1) end
    seen[value] = nil
    return result
end
function M.encode(value) return json.encode(copy(value, {}, 1)) end
local function utf8(cp)
    if cp < 128 then return string.char(cp) end
    if cp < 2048 then return string.char(192+math.floor(cp/64),128+cp%64) end
    if cp < 65536 then return string.char(224+math.floor(cp/4096),128+math.floor(cp/64)%64,128+cp%64) end
    return string.char(240+math.floor(cp/262144),128+math.floor(cp/4096)%64,128+math.floor(cp/64)%64,128+cp%64)
end
function M.decode(text)
    assert(type(text) == "string", "invalid JSON state")
    local pos, length = 1, #text
    local function skip() while text:sub(pos,pos):match("^[ \t\r\n]$") do pos=pos+1 end end
    local function hex()
        local digits=text:sub(pos,pos+3)
        assert(#digits == 4 and digits:match("^%x%x%x%x$"), "invalid Unicode escape")
        pos=pos+4
        return tonumber(digits,16)
    end
    local function string_value()
        assert(text:sub(pos,pos) == '"', "expected JSON string")
        pos=pos+1
        local chunks={}
        while pos <= length do
            local c=text:sub(pos,pos); pos=pos+1
            if c == '"' then
                local result=table.concat(chunks)
                reading.count(result)
                return result
            elseif c == "\\" then
                local e=text:sub(pos,pos); pos=pos+1
                local escapes={['"']='"',['\\']='\\',['/']='/',b='\b',f='\f',n='\n',r='\r',t='\t'}
                if e == "u" then
                    local cp=hex()
                    if cp >= 0xD800 and cp <= 0xDBFF then
                        assert(text:sub(pos,pos+1) == "\\u", "invalid surrogate pair")
                        pos=pos+2
                        local low=hex()
                        assert(low >= 0xDC00 and low <= 0xDFFF, "invalid surrogate pair")
                        cp=0x10000+(cp-0xD800)*1024+low-0xDC00
                    else
                        assert(cp < 0xDC00 or cp > 0xDFFF, "invalid surrogate")
                    end
                    chunks[#chunks+1]=utf8(cp)
                else
                    assert(escapes[e], "invalid JSON escape")
                    chunks[#chunks+1]=escapes[e]
                end
            else
                assert(c:byte() >= 32, "invalid JSON string")
                chunks[#chunks+1]=c
            end
        end
        error("unterminated JSON string")
    end
    local parse
    parse=function(depth)
        assert(depth <= 128, "JSON state nesting too deep")
        skip()
        local c=text:sub(pos,pos)
        if c == '"' then return string_value() end
        if c == "{" then
            pos=pos+1; skip()
            local obj={}
            if text:sub(pos,pos) == "}" then pos=pos+1; return obj end
            while true do
                skip(); local key=string_value(); skip()
                assert(obj[key] == nil and text:sub(pos,pos) == ":", "invalid JSON object")
                pos=pos+1; obj[key]=parse(depth+1); skip()
                local delim=text:sub(pos,pos); pos=pos+1
                if delim == "}" then return obj end
                assert(delim == ",", "invalid JSON object")
            end
        elseif c == "[" then
            pos=pos+1; skip()
            local arr=json.array({})
            if text:sub(pos,pos) == "]" then pos=pos+1; return arr end
            while true do
                arr[#arr+1]=parse(depth+1); skip()
                local delim=text:sub(pos,pos); pos=pos+1
                if delim == "]" then return arr end
                assert(delim == ",", "invalid JSON array")
            end
        end
        for _, token in ipairs({"true","false","null"}) do
            if text:sub(pos,pos+#token-1) == token then
                pos=pos+#token
                if token == "true" then return true end
                if token == "false" then return false end
                return json.null
            end
        end
        local token=text:sub(pos):match("^[%d%.%+%-%eE]+")
        assert(token, "invalid JSON value")
        local integer, rest=token:match("^(%-?%d+)(.*)$")
        assert(integer and not integer:match("^%-?0%d"), "invalid JSON number")
        if rest:sub(1,1) == "." then
            local fraction, tail=rest:match("^(%.%d+)(.*)$")
            assert(fraction, "invalid JSON number"); rest=tail
        end
        assert(rest == "" or rest:match("^[eE][%+%-]?%d+$"), "invalid JSON number")
        local number=tonumber(token)
        assert(number and number == number and math.abs(number) <= 9007199254740991, "JSON number out of range")
        pos=pos+#token
        return number
    end
    local result=parse(1); skip()
    assert(pos > length, "trailing JSON state")
    return result
end
return M
