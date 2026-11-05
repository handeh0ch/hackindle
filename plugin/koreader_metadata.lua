local identity=require("identity")
local json=require("wire_json")
local M={}

-- The resolver must verify exact-file SHA-256 and format using a stable read.
-- KOReader metadata field availability and resolver behavior remain unverified
-- on device; missing evidence leaves the source unavailable.
function M.new(resolve,utc_now)
    assert(type(resolve)=="function" and type(utc_now)=="function", "source resolver unavailable")
    local adapter={}
    function adapter:source(ui)
        assert(type(ui)=="table" and type(ui.document)=="table" and type(ui.document.file)=="string" and ui.document.file~="", "document unavailable")
        local props=ui.doc_props
        assert(type(props)=="table" and type(props.display_title)=="string", "metadata unavailable")
        local resolved=resolve(ui.document.file)
        assert(type(resolved)=="table" and resolved.verified==true and (resolved.format=="epub" or resolved.format=="mobi" or resolved.format=="pdf"), "source identity unavailable")
        identity.source(resolved.source_id)
        local captured_at=utc_now()
        assert(type(captured_at)=="string" and pcall(require("utc").due,captured_at,nil,false), "UTC timestamp unavailable")
        assert(props.authors==nil or type(props.authors)=="string", "authors unavailable")
        assert(props.language==nil or type(props.language)=="string", "language unavailable")
        local authors={}; if props.authors and props.authors~="" then authors[1]=props.authors end
        return {verified=true,reset=resolved.reset==true,source_id=resolved.source_id,captured_at=captured_at,
            metadata={format=resolved.format,title=props.display_title,authors=authors,
                language=props.language or json.null,identifiers={}}}
    end
    -- These native observations require separate adapter evidence.
    function adapter:begin_page() return nil end
    function adapter:finish_page() return nil end
    function adapter:annotations() return nil end
    return adapter
end
return M
