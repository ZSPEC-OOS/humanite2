package ratelimit_test

import (
	"context"
	"testing"
	"time"

	"humanite/gateway/internal/ratelimit"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestLimiter(t *testing.T) (*ratelimit.Limiter, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to start miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return ratelimit.New(rdb), mr
}

func TestAllowFirstRequest(t *testing.T) {
	limiter, mr := newTestLimiter(t)
	defer mr.Close()

	allowed, remaining, _, err := limiter.Allow(context.Background(), "user-1", "free", "/v1/humanize")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if !allowed {
		t.Error("First request should be allowed")
	}
	if remaining != 9 {
		t.Errorf("Expected 9 remaining after first request, got %d", remaining)
	}
}

func TestExhaustFreeLimit(t *testing.T) {
	limiter, mr := newTestLimiter(t)
	defer mr.Close()

	ctx := context.Background()
	// Exhaust the 10-request free tier limit
	for i := 0; i < 10; i++ {
		allowed, _, _, _ := limiter.Allow(ctx, "user-free", "free", "/v1/humanize")
		if !allowed {
			t.Fatalf("Request %d should have been allowed but was denied", i+1)
		}
	}

	// 11th request must be denied
	allowed, remaining, _, _ := limiter.Allow(ctx, "user-free", "free", "/v1/humanize")
	if allowed {
		t.Error("11th request should be denied for free tier")
	}
	if remaining != 0 {
		t.Errorf("Remaining should be 0 when exhausted, got %d", remaining)
	}
}

func TestProTierHigherLimit(t *testing.T) {
	limiter, mr := newTestLimiter(t)
	defer mr.Close()

	ctx := context.Background()
	// Pro tier allows 100 per minute — first 100 must all pass
	for i := 0; i < 100; i++ {
		allowed, _, _, _ := limiter.Allow(ctx, "user-pro", "pro", "/v1/humanize")
		if !allowed {
			t.Fatalf("Pro request %d should be allowed but was denied", i+1)
		}
	}
	// 101st denied
	allowed, _, _, _ := limiter.Allow(ctx, "user-pro", "pro", "/v1/humanize")
	if allowed {
		t.Error("101st request should be denied for pro tier")
	}
}

func TestDifferentUsersHaveIndependentBuckets(t *testing.T) {
	limiter, mr := newTestLimiter(t)
	defer mr.Close()

	ctx := context.Background()
	// Exhaust user-a
	for i := 0; i < 10; i++ {
		limiter.Allow(ctx, "user-a", "free", "/v1/humanize")
	}
	// user-b should still be allowed
	allowed, _, _, _ := limiter.Allow(ctx, "user-b", "free", "/v1/humanize")
	if !allowed {
		t.Error("user-b should not be affected by user-a's exhausted bucket")
	}
}

func TestDifferentEndpointsHaveIndependentBuckets(t *testing.T) {
	limiter, mr := newTestLimiter(t)
	defer mr.Close()

	ctx := context.Background()
	// Exhaust /v1/humanize
	for i := 0; i < 10; i++ {
		limiter.Allow(ctx, "user-1", "free", "/v1/humanize")
	}
	// /v1/scan should still have its own bucket
	allowed, _, _, _ := limiter.Allow(ctx, "user-1", "free", "/v1/scan")
	if !allowed {
		t.Error("/v1/scan should have independent rate limit bucket from /v1/humanize")
	}
}

func TestUnknownTierDefaultsToFree(t *testing.T) {
	limiter, mr := newTestLimiter(t)
	defer mr.Close()

	ctx := context.Background()
	allowed, remaining, _, err := limiter.Allow(ctx, "user-1", "unknown_tier", "/v1/humanize")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if !allowed {
		t.Error("First request with unknown tier should be allowed (defaults to free)")
	}
	if remaining != 9 {
		t.Errorf("Unknown tier should default to free (capacity 10), got remaining=%d", remaining)
	}
}

func TestWindowTTLResetsBucket(t *testing.T) {
	limiter, mr := newTestLimiter(t)
	defer mr.Close()

	ctx := context.Background()
	// Exhaust free tier
	for i := 0; i < 10; i++ {
		limiter.Allow(ctx, "user-ttl", "free", "/v1/humanize")
	}
	denied, _, _, _ := limiter.Allow(ctx, "user-ttl", "free", "/v1/humanize")
	if denied {
		t.Error("Should be denied after exhaustion")
	}

	// Fast-forward miniredis time to expire the TTL
	mr.FastForward(time.Hour + time.Second)

	// Should be allowed again after window reset
	allowed, _, _, _ := limiter.Allow(ctx, "user-ttl", "free", "/v1/humanize")
	if !allowed {
		t.Error("Should be allowed again after TTL expiry")
	}
}
