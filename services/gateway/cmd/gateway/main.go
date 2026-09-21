package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"

	goredis "github.com/redis/go-redis/v9"
	"humanite/gateway/internal/auth"
	"humanite/gateway/internal/middleware"
	"humanite/gateway/internal/ratelimit"
)

func main() {
	pubKeyPEM := mustEnv("JWT_PUBLIC_KEY")
	pubKey, err := auth.ParsePublicKey(pubKeyPEM)
	if err != nil {
		log.Fatalf("Failed to parse JWT public key: %v", err)
	}

	redisURL := getEnv("REDIS_URL", "redis://redis:6379/2")
	opts, err := goredis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}
	rdb := goredis.NewClient(opts)
	limiter := ratelimit.New(rdb)

	orchestrationURL, _ := url.Parse(getEnv("UPSTREAM_ORCHESTRATION", "http://orchestration:8000"))
	userMgmtURL, _ := url.Parse(getEnv("UPSTREAM_USER_MGMT", "http://user-management:8004"))

	orchestrationProxy := httputil.NewSingleHostReverseProxy(orchestrationURL)
	userMgmtProxy := httputil.NewSingleHostReverseProxy(userMgmtURL)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /v1/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"gateway","version":"0.8.0"}`))
	})

	mux.Handle("/v1/auth/", userMgmtProxy)
	mux.Handle("/v1/user/", userMgmtProxy)
	mux.Handle("/v1/", orchestrationProxy)

	// Middleware chain — outermost applied last
	var handler http.Handler = mux
	handler = middleware.Auth(pubKey)(handler)
	handler = ratelimit.Middleware(limiter)(handler)
	handler = middleware.SecurityHeaders(handler)

	addr := ":" + getEnv("PORT", "8080")
	log.Printf("Gateway listening on %s (rate limiting enabled)", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("Required environment variable %s is not set", key)
	}
	return v
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
