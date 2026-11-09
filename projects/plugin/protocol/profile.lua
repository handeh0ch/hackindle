local M = {}
local function load(tx, codec)
    local value = tx:get("profile")
    assert(value, "sync profile unavailable")
    return codec.decode(value)
end
local function save(tx, codec, policy) tx:put("profile", codec.encode(policy)) end
function M.accept(store, codec, config, device_id)
    assert(config.schema_version == 1 and type(config.instance_id) == "string"
        and type(config.reporting_timezone) == "string" and config.reporting_timezone ~= ""
        and type(config.characters_per_page) == "number" and config.characters_per_page >= 1 and config.characters_per_page <= 9007199254740991
        and config.characters_per_page == math.floor(config.characters_per_page)
        and type(config.reset_generation) == "number" and config.reset_generation >= 0 and config.reset_generation <= 9007199254740991
        and config.reset_generation == math.floor(config.reset_generation)
        and (config.unicode_version == nil or type(config.unicode_version) == "string"), "invalid sync profile")
    return store:transaction(function(tx)
        local encoded = tx:get("profile")
        if not encoded then
            assert(not device_id or not tx:get("seq"), "unbound device state requires recovery")
            tx:put("capture_generation", config.reset_generation == 0 and "0" or "blocked")
            save(tx, codec, {instance_id=config.instance_id, timezone=config.reporting_timezone,
                denominator=config.characters_per_page, generation=config.reset_generation, baselines={}, baseline_required=config.reset_generation > 0, device_id=device_id, unicode_version=config.unicode_version})
            return config.reset_generation > 0 and "baseline_required" or "initialized"
        end
        local policy = codec.decode(encoded)
        assert(policy.instance_id == config.instance_id and policy.timezone == config.reporting_timezone
            and policy.denominator == config.characters_per_page, "sync profile mismatch")
        assert(not device_id or not policy.device_id or policy.device_id == device_id, "device identity mismatch")
        if device_id and not policy.device_id then
            assert(not tx:get("seq"), "unbound device state requires recovery")
            policy.device_id = device_id; save(tx, codec, policy)
        end
        assert(config.reset_generation >= policy.generation, "reset generation regressed")
        if config.reset_generation == policy.generation then
            if policy.unicode_version~=config.unicode_version then policy.unicode_version=config.unicode_version; save(tx,codec,policy) end
            return "unchanged"
        end
        tx:put("capture_generation", "blocked")
        policy.generation = config.reset_generation
        policy.unicode_version = config.unicode_version
        policy.baselines = {}
        policy.baseline_required = true
        save(tx, codec, policy)
        return "baseline_required"
    end)
end
function M.ready_tx(tx, codec, dataset, source)
    local policy = load(tx, codec)
    return not policy.baseline_required or (policy.baselines[dataset] and policy.baselines[dataset][source] ~= nil) or false
end
function M.ready(store, codec, dataset, source)
    return store:transaction(function(tx) return M.ready_tx(tx, codec, dataset, source) end)
end
-- read must be a complete native set captured at the reset barrier; the
-- fingerprint function and the timing of that read require adapter evidence.
function M.policy_tx(tx, codec) return load(tx, codec) end
function M.baseline_tx(tx, codec, dataset, source, generation, records, fingerprint)
    local policy = load(tx, codec)
    assert(policy.baseline_required and policy.generation == generation, "reset baseline generation changed")
    policy.baselines[dataset] = policy.baselines[dataset] or {}
    assert(not policy.baselines[dataset][source], "baseline already established")
    local entries = {}
    for _, item in ipairs(records) do
        assert(type(item.id) == "string" and item.id ~= "" and entries[item.id] == nil, "invalid baseline identity")
        local digest = fingerprint(item)
        assert(type(digest) == "string" and digest ~= "", "baseline fingerprint unavailable")
        entries[item.id] = digest
    end
    policy.baselines[dataset][source] = entries
    save(tx, codec, policy)
end
function M.baseline(store, codec, dataset, source, generation, records, fingerprint)
    if records == nil then return false end
    return store:transaction(function(tx)
        M.baseline_tx(tx, codec, dataset, source, generation, records, fingerprint)
        return true
    end)
end
-- observed_new must come from a verified native post-baseline save event.
function M.filter_tx(tx, codec, dataset, source, records, fingerprint, observed_new)
    local policy = load(tx, codec)
    if not policy.baseline_required then return records end
    local entries = policy.baselines[dataset] and policy.baselines[dataset][source]
    assert(entries, "reset baseline pending")
    local result, seen = {}, {}
    for _, item in ipairs(records) do
        assert(type(item.id) == "string" and item.id ~= "" and not seen[item.id], "invalid baseline identity")
        seen[item.id] = true
        local digest = fingerprint(item)
        assert(type(digest) == "string" and digest ~= "", "baseline fingerprint unavailable")
        if entries[item.id] ~= digest or (observed_new and observed_new[item.id] == true) then
            entries[item.id] = nil
            result[#result + 1] = item
        end
    end
    save(tx, codec, policy)
    return result
end
return M
