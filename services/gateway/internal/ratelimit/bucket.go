package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// TierConfig defines the token bucket parameters per subscription tier.
type TierConfig struct {
	Capacity   int64         // Maximum tokens in the bucket
	RefillRate int64         // Tokens added per window
	Window     time.Duration // Refill window size
}

// Tiers maps tier name → rate limit config.
var Tiers = map[string]TierConfig{
	"free":       {Capacity: 10, RefillRate: 10, Window: time.Hour},
	"pro":        {Capacity: 100, RefillRate: 100, Window: time.Minute},
	"enterprise": {Capacity: 1000, RefillRate: 1000, Window: time.Minute},
}

func defaultTier() TierConfig {
	return Tiers["free"]
}

// atomicTokenBucket is a Lua script that atomically checks and decrements
// the token bucket. Returns {1, remaining} if allowed, {0, 0} if exhausted.
// Using Lua ensures the read-check-decrement is atomic on the Redis server
// with no race condition between concurrent requests.
var atomicTokenBucket = redis.NewScript(`
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local ttl_secs = tonumber(ARGV[2])

local tokens = tonumber(redis.call('GET', key))
if tokens == nil then
    tokens = capacity
end

if tokens > 0 then
    local remaining = tokens - 1
    redis.call('SET', key, remaining, 'EX', ttl_secs)
    return {1, remaining}
else
    return {0, 0}
end
`)

// Limiter holds a Redis client and exposes rate limit checks.
type Limiter struct {
	rdb *redis.Client
}

// New creates a Limiter backed by the provided Redis client.
func New(rdb *redis.Client) *Limiter {
	return &Limiter{rdb: rdb}
}

// Allow checks whether the request is within rate limits.
// Returns (allowed, remaining, resetAfter, error).
// On Redis error: fail open (allow the request) and log.
func (l *Limiter) Allow(
	ctx context.Context,
	userID string,
	tier string,
	endpoint string,
) (allowed bool, remaining int64, resetAfter time.Duration, err error) {
	cfg, ok := Tiers[tier]
	if !ok {
		cfg = defaultTier()
	}

	key := fmt.Sprintf("rl:%s:%s", userID, endpoint)
	ttl := int64(cfg.Window.Seconds())

	result, err := atomicTokenBucket.Run(
		ctx, l.rdb,
		[]string{key},
		cfg.Capacity,
		ttl,
	).Int64Slice()

	if err != nil {
		// Fail open on Redis error — do not block user traffic
		return true, 0, cfg.Window, err
	}

	allowed = result[0] == 1
	remaining = result[1]
	resetAfter = cfg.Window

	return allowed, remaining, resetAfter, nil
}
