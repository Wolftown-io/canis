-- Atomic rate limit check and increment
-- KEYS[1] = rate limit key
-- ARGV[1] = TTL (window in seconds)
-- ARGV[2] = limit (max requests)
-- Returns: {count, allowed (1/0), ttl}

local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[2])

if count >= limit then
    local ttl = redis.call('TTL', KEYS[1])
    if ttl < 0 then ttl = tonumber(ARGV[1]) end
    return {count, 0, ttl}
end

count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end

local ttl = redis.call('TTL', KEYS[1])
return {count, 1, ttl}
