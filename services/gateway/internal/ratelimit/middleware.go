package ratelimit

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"
)

// Middleware returns an HTTP middleware that enforces per-user rate limits.
// It reads user identity from the X-User-ID and X-User-Tier headers, which
// are injected by the auth middleware earlier in the chain.
func Middleware(limiter *Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip rate limiting for unauthenticated paths
			userID := r.Header.Get("X-User-ID")
			if userID == "" {
				next.ServeHTTP(w, r)
				return
			}

			tier := r.Header.Get("X-User-Tier")
			endpoint := r.URL.Path

			allowed, remaining, resetAfter, err := limiter.Allow(
				r.Context(), userID, tier, endpoint,
			)
			if err != nil {
				// Log Redis error but do not block the request
				log.Printf("rate_limit_redis_error user_id=%s err_type=%T", userID, err)
			}

			cfg, ok := Tiers[tier]
			if !ok {
				cfg = defaultTier()
			}

			// Always set rate limit headers on responses
			w.Header().Set("RateLimit-Limit", strconv.FormatInt(cfg.Capacity, 10))
			w.Header().Set("RateLimit-Remaining", strconv.FormatInt(remaining, 10))
			w.Header().Set("RateLimit-Reset",
				strconv.FormatInt(time.Now().Add(resetAfter).Unix(), 10))

			if !allowed {
				retryAfterSecs := int64(resetAfter.Seconds())
				w.Header().Set("Retry-After", strconv.FormatInt(retryAfterSecs, 10))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"error": map[string]string{
						"code":    "RATE_LIMIT_EXCEEDED",
						"message": "Rate limit exceeded. See Retry-After header for reset time.",
					},
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
