-- Reports only an already established connection. It never calls the network
-- manager paths that can switch Wi-Fi on or show a prompt (runWhenOnline,
-- beforeWifiAction ...), and never isOnline(), which performs a DNS lookup.
-- That isConnected() is side-effect free on the Kindle build is unverified (I1).
local M = {}
function M.online(manager)
    local ok, connected = pcall(function()
        manager = manager or require("ui/network/manager")
        return manager:isConnected()
    end)
    return ok and connected == true
end
return M
