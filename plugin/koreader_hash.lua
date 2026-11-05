local identity = require("identity")
local M = {}
-- read() must yield all bytes of one stable file version, then nil; it must
-- return nil plus an error on failure. File stability is an adapter obligation.
-- ffi/sha2 availability on the installed device remains unverified.
function M.stream(read, sha2)
    sha2 = sha2 or require("ffi/sha2")
    local update = sha2.sha256()
    assert(type(update) == "function", "SHA-256 unavailable")
    while true do
        local chunk, err = read()
        if chunk == nil then
            assert(err == nil, "source read failed")
            break
        end
        assert(type(chunk) == "string" and #chunk > 0, "invalid source read")
        update(chunk)
    end
    return identity.source(update())
end

-- Two bounded passes and unchanged file attributes detect ordinary concurrent
-- edits. They are not a lock; filesystem timestamp granularity and device
-- behavior remain unverified. Callers must schedule steps off the UI path and
-- recheck identity if the source may subsequently change.
function M.begin_file(path,format,options)
    options=options or {}
    assert(type(path)=="string" and path~="" and options.format_verified==true
        and (format=="epub" or format=="mobi" or format=="pdf"), "source format unavailable")
    local stat=options.stat or require("libs/libkoreader-lfs").attributes
    local open=options.open or io.open
    local sha2=options.sha2 or require("ffi/sha2")
    local fields={"dev","ino","size","modification","change"}
    local function attributes()
        local value=stat(path)
        assert(type(value)=="table" and value.mode=="file", "source unavailable")
        local copy={}
        for _,key in ipairs(fields) do
            local n=value[key]; assert(type(n)=="number" and n==n and n~=math.huge and n~=-math.huge, "source identity unavailable"); copy[key]=n
        end
        assert(copy.size>=0 and copy.size<=9007199254740991 and copy.size==math.floor(copy.size), "source size invalid")
        return copy
    end
    local initial=attributes()
    local update=sha2.sha256(); assert(type(update)=="function", "SHA-256 unavailable")
    local file=assert(open(path,"rb"), "source unavailable")
    local function unchanged()
        local current=attributes()
        for _,key in ipairs(fields) do assert(current[key]==initial[key], "source changed") end
    end
    local ok=pcall(unchanged)
    if not ok then pcall(function() file:close() end); error("source unavailable") end
    local job={pass=1,count=0,update=update,done=false}
    function job:cancel()
        assert(not self.done, "source job already finished")
        self.done=true
        local success,result=pcall(function() return file:close() end)
        return success and result and true or false
    end
    function job:step(limit)
        assert(not self.done, "source job already finished")
        assert(type(limit)=="number" and limit>=1 and limit<=65536 and limit==math.floor(limit), "invalid chunk limit")
        local success,result=pcall(function()
            unchanged()
            local chunk,err=file:read(limit)
            if chunk~=nil then
                assert(type(chunk)=="string" and #chunk>0 and #chunk<=limit, "invalid source read")
                self.count=self.count+#chunk; assert(self.count<=initial.size, "source changed")
                self.update(chunk); return false
            end
            assert(err==nil and self.count==initial.size, "source read failed")
            unchanged()
            local digest=identity.source(self.update())
            if self.pass==1 then
                self.first=digest; self.pass=2; self.count=0
                assert(file:seek("set",0)==0, "source seek failed")
                self.update=sha2.sha256(); assert(type(self.update)=="function", "SHA-256 unavailable"); return false
            end
            assert(digest==self.first, "source changed")
            assert(file:close(), "source close failed")
            self.done=true
            return {source_id=digest,format=format,verified=true,evidence="two_pass_stat",
                unchanged=function() return pcall(unchanged) end}
        end)
        if success then return result end
        pcall(function() file:close() end); self.done=true
        return nil,"source_unavailable"
    end
    return job
end
return M
