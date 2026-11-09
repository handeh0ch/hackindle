package.path = "projects/plugin/?.lua;" .. package.path
local profile = require("protocol.profile")
local saved = {}
local function clone(v) if type(v) ~= "table" then return v end; local x={}; for k,a in pairs(v) do x[k]=clone(a) end; return x end
local store={}
function store:transaction(f)
    local pending=clone(saved); local tx={}
    function tx:get(k) return pending[k] end; function tx:put(k,v) pending[k]=clone(v) end
    local result=f(tx); saved=pending; return result
end
local codec={encode=clone,decode=clone}
local config={schema_version=1,instance_id="instance-a",reporting_timezone="UTC",characters_per_page=2000,reset_generation=0}
assert(profile.accept(store,codec,config) == "initialized")
assert(profile.accept(store,codec,config) == "unchanged")
local bad=clone(config); bad.instance_id="instance-b"
assert(not pcall(function() profile.accept(store,codec,bad) end))
bad=clone(config); bad.reporting_timezone="Other"
assert(not pcall(function() profile.accept(store,codec,bad) end))
bad=clone(config); bad.characters_per_page=1000
assert(not pcall(function() profile.accept(store,codec,bad) end))
local reset=clone(config); reset.reset_generation=1
assert(profile.accept(store,codec,reset) == "baseline_required")
assert(profile.ready(store,codec,"annotations", "source-a") == false)
print("profile assertions passed")
local objects={{id="old",value="a"},{id="same",value="b"}}
local function fingerprint(item) return item.value end
assert(profile.baseline(store,codec,"annotations","source-a",1,nil,fingerprint) == false)
assert(profile.baseline(store,codec,"annotations","source-a",1,objects,fingerprint) == true)
assert(profile.ready(store,codec,"annotations","source-a") == true)
local changed={{id="old",value="edited"},{id="same",value="b"},{id="new",value="c"}}
local filtered=store:transaction(function(tx) return profile.filter_tx(tx,codec,"annotations","source-a",changed,fingerprint) end)
assert(#filtered == 2 and filtered[1].id == "old" and filtered[2].id == "new")
local reverted={{id="old",value="a"},{id="same",value="b"},{id="new",value="c"}}
local again=store:transaction(function(tx) return profile.filter_tx(tx,codec,"annotations","source-a",reverted,fingerprint) end)
assert(#again == 2 and again[1].id == "old" and again[2].id == "new")

assert(not pcall(function() store:transaction(function(tx) return profile.filter_tx(tx,codec,"annotations","source-b",changed,fingerprint) end) end))

saved = {}
assert(profile.accept(store,codec,reset) == "baseline_required")
assert(profile.ready(store,codec,"vocabulary","global") == false)

assert(not pcall(function() profile.baseline(store,codec,"annotations","stale",0,objects,fingerprint) end))
local next_reset=clone(reset); next_reset.reset_generation=2
assert(profile.accept(store,codec,next_reset) == "baseline_required")
assert(not profile.ready(store,codec,"annotations","source-a"))
assert(profile.baseline(store,codec,"annotations","source-a",2,changed,fingerprint))
assert(#store:transaction(function(tx) return profile.filter_tx(tx,codec,"annotations","source-a",changed,fingerprint) end) == 0)

assert(profile.baseline(store,codec,"annotations","rollback",2,{{id="x",value="before"}},fingerprint))
assert(not pcall(function() store:transaction(function(tx)
    profile.filter_tx(tx,codec,"annotations","rollback",{{id="x",value="after"}},fingerprint)
    error("packet failed")
end) end))
assert(#store:transaction(function(tx) return profile.filter_tx(tx,codec,"annotations","rollback",{{id="x",value="before"}},fingerprint) end) == 0)
local too_large=clone(config); too_large.reset_generation=9007199254740992
assert(not pcall(function() profile.accept(store,codec,too_large) end))
assert(profile.baseline(store,codec,"vocabulary","global",2,{{id="same",value="original"}},fingerprint))
local same={{id="same",value="original"}}
local replay=store:transaction(function(tx) return profile.filter_tx(tx,codec,"vocabulary","global",same,fingerprint) end)
assert(#replay==0)
local resaved=store:transaction(function(tx) return profile.filter_tx(tx,codec,"vocabulary","global",same,fingerprint,{same=true}) end)
assert(#resaved==1)
assert(#store:transaction(function(tx) return profile.filter_tx(tx,codec,"vocabulary","global",same,fingerprint) end)==1)
