package redis

import redisclient "github.com/redis/go-redis/v9"

// 本文件承载 Redis 运行态存储使用的全部 Lua 脚本定义。

var rateScript = redisclient.NewScript(`
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if current > tonumber(ARGV[1]) then return 0 end
return 1
`)

var acquireLeaseScript = redisclient.NewScript(`
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`)

var releaseLeaseScript = redisclient.NewScript(`return redis.call('ZREM', KEYS[1], ARGV[1])`)

var releaseLockScript = redisclient.NewScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`)

var setStickyScript = redisclient.NewScript(`
local old = redis.call('GET', KEYS[1])
if old and old ~= ARGV[1] then redis.call('ZREM', ARGV[3] .. old, KEYS[1]) end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[5], KEYS[1])
local excess = redis.call('ZCARD', KEYS[2]) - tonumber(ARGV[6])
if excess > 0 then
  local stale = redis.call('ZRANGE', KEYS[2], 0, excess - 1)
  for _, key in ipairs(stale) do
    if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key) end
    redis.call('ZREM', KEYS[2], key)
  end
end
if redis.call('PTTL', KEYS[2]) < tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
return 1
`)

var bindStickyScript = redisclient.NewScript(`
local selected = redis.call('GET', KEYS[1])
if not selected then selected = ARGV[1] end
local accountSetKey = ARGV[3] .. selected
redis.call('SET', KEYS[1], selected, 'PX', ARGV[2])
redis.call('ZREMRANGEBYSCORE', accountSetKey, '-inf', ARGV[4])
redis.call('ZADD', accountSetKey, ARGV[5], KEYS[1])
local excess = redis.call('ZCARD', accountSetKey) - tonumber(ARGV[6])
if excess > 0 then
  local stale = redis.call('ZRANGE', accountSetKey, 0, excess - 1)
  for _, key in ipairs(stale) do
    if redis.call('GET', key) == selected then redis.call('DEL', key) end
    redis.call('ZREM', accountSetKey, key)
  end
end
if redis.call('PTTL', accountSetKey) < tonumber(ARGV[2]) then redis.call('PEXPIRE', accountSetKey, ARGV[2]) end
return selected
`)

var deleteStickyByAccountScript = redisclient.NewScript(`
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
local deleted = 0
for _, key in ipairs(members) do
  if redis.call('GET', key) == ARGV[1] then
    deleted = deleted + redis.call('DEL', key)
  end
end
redis.call('DEL', KEYS[1])
return deleted
`)

var createDeviceSessionScript = redisclient.NewScript(`
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 0 end
if not redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3], 'NX') then return -1 end
redis.call('ZADD', KEYS[2], ARGV[5], KEYS[1])
if redis.call('PTTL', KEYS[2]) < tonumber(ARGV[3]) then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
return 1
`)

var updateDeviceSessionScript = redisclient.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'XX')
redis.call('ZADD', KEYS[2], ARGV[3], KEYS[1])
if redis.call('PTTL', KEYS[2]) < tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
return 1
`)

var deleteDeviceSessionScript = redisclient.NewScript(`
redis.call('ZREM', KEYS[2], KEYS[1])
return redis.call('DEL', KEYS[1])
`)

var scheduleQuotaRecoveryScript = redisclient.NewScript(`
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 1 then return 2 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
redis.call('HDEL', KEYS[3], ARGV[1])
return 1
`)

var ensureQuotaRecoveryScript = redisclient.NewScript(`
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 2 end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
return 1
`)

var cancelQuotaRecoveryScript = redisclient.NewScript(`
if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 1 then return 2 end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
return redis.call('ZREM', KEYS[1], ARGV[1])
`)

var claimQuotaRecoveryScript = redisclient.NewScript(`
local values = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
local result = {}
for _, value in ipairs(values) do
  redis.call('ZADD', KEYS[1], ARGV[3], value)
  redis.call('HSET', KEYS[3], value, ARGV[4])
  table.insert(result, value)
  table.insert(result, redis.call('HGET', KEYS[2], value) or '0')
  table.insert(result, ARGV[4])
end
return result
`)

var ackQuotaRecoveryScript = redisclient.NewScript(`
if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
return redis.call('ZREM', KEYS[1], ARGV[1])
`)

var markQuotaRefreshDirtyScript = redisclient.NewScript(`
local now = tonumber(ARGV[4])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 1000)
for _, member in ipairs(expired) do
  redis.call('ZREM', KEYS[3], member)
  redis.call('ZREM', KEYS[2], member)
  redis.call('HDEL', KEYS[1], member)
end
local memberExpires = redis.call('ZSCORE', KEYS[3], ARGV[1])
if memberExpires and tonumber(memberExpires) <= now then
  redis.call('ZREM', KEYS[3], ARGV[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  redis.call('HDEL', KEYS[1], ARGV[1])
end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if not redis.call('ZSCORE', KEYS[2], ARGV[1]) and redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return 0 end
local generation = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[2], ARGV[1])
local latest = redis.call('ZREVRANGE', KEYS[3], 0, 0, 'WITHSCORES')
if #latest == 2 then
  redis.call('PEXPIREAT', KEYS[1], latest[2])
  redis.call('PEXPIREAT', KEYS[2], latest[2])
  redis.call('PEXPIREAT', KEYS[3], latest[2])
end
return generation
`)

var clearQuotaRefreshDirtyScript = redisclient.NewScript(`
local retentionExpires = redis.call('ZSCORE', KEYS[3], ARGV[1])
if not retentionExpires or tonumber(retentionExpires) <= tonumber(ARGV[3]) then
  redis.call('ZREM', KEYS[3], ARGV[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  redis.call('HDEL', KEYS[1], ARGV[1])
  return 0
end
local dirtyExpires = redis.call('ZSCORE', KEYS[2], ARGV[1])
if not dirtyExpires or tonumber(dirtyExpires) <= tonumber(ARGV[3]) then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 0
end
if tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0') ~= tonumber(ARGV[2]) then return 0 end
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`)

var listQuotaRefreshDirtyScript = redisclient.NewScript(`
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[1])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 1000)
for _, member in ipairs(expired) do
  redis.call('ZREM', KEYS[3], member)
  redis.call('ZREM', KEYS[2], member)
  redis.call('HDEL', KEYS[1], member)
end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local members = redis.call('ZRANGEBYSCORE', KEYS[2], '(' .. ARGV[1], '+inf', 'LIMIT', 0, limit)
local result = {}
for _, member in ipairs(members) do
  local retentionExpires = redis.call('ZSCORE', KEYS[3], member)
  local generation = redis.call('HGET', KEYS[1], member)
  if retentionExpires and tonumber(retentionExpires) > now and generation then
    table.insert(result, member)
    table.insert(result, generation)
  end
end
return result
`)

var setObservedModelStateScript = redisclient.NewScript(`
local previous = redis.call('HGET', KEYS[1], 'observed_at')
if previous and tonumber(previous) > tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], 'model', ARGV[1], 'observed_at', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`)

var quotaRefreshStateScript = redisclient.NewScript(`
local generation = redis.call('HGET', KEYS[1], ARGV[1]) or '0'
local retentionExpires = redis.call('ZSCORE', KEYS[3], ARGV[1])
if not retentionExpires or tonumber(retentionExpires) <= tonumber(ARGV[2]) then
  redis.call('ZREM', KEYS[3], ARGV[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  redis.call('HDEL', KEYS[1], ARGV[1])
  generation = '0'
  return {generation, '0'}
end
local dirtyExpires = redis.call('ZSCORE', KEYS[2], ARGV[1])
local dirty = '0'
if dirtyExpires and tonumber(dirtyExpires) > tonumber(ARGV[2]) then
  dirty = '1'
elseif dirtyExpires then
  redis.call('ZREM', KEYS[2], ARGV[1])
end
return {generation, dirty}
`)

var rescheduleQuotaRecoveryScript = redisclient.NewScript(`
if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[4] then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
redis.call('HDEL', KEYS[3], ARGV[1])
return 1
`)
